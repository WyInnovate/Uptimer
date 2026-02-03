import { Hono } from 'hono';
import { z } from 'zod';

import { getDb, monitors } from '@uptimer/db';

import type { Env } from '../env';
import { computePublicStatusPayload } from '../public/status';
import { applyStatusCacheHeaders, readStatusSnapshot, writeStatusSnapshot } from '../snapshots';
import { AppError } from '../middleware/errors';
import { cachePublic } from '../middleware/cache-public';

export const publicRoutes = new Hono<{ Bindings: Env }>();

// Cache public endpoints at the edge to improve performance on slow networks.
publicRoutes.use('*', cachePublic({ cacheName: 'uptimer-public', maxAgeSeconds: 30 }));

const latencyRangeSchema = z.enum(['24h']);
const uptimeRangeSchema = z.enum(['24h', '7d', '30d']);
const uptimeOverviewRangeSchema = z.enum(['30d', '90d']);

type Interval = { start: number; end: number };

function toCheckStatus(value: string | null): 'up' | 'down' | 'maintenance' | 'unknown' {
  switch (value) {
    case 'up':
    case 'down':
    case 'maintenance':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const first = sorted[0];
  if (!first) return [];

  const merged: Interval[] = [{ start: first.start, end: first.end }];

  for (const cur of sorted.slice(1)) {
    if (!cur) continue;

    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ start: cur.start, end: cur.end });
      continue;
    }

    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
      continue;
    }

    merged.push({ start: cur.start, end: cur.end });
  }

  return merged;
}

function sumIntervals(intervals: Interval[]): number {
  return intervals.reduce((acc, it) => acc + Math.max(0, it.end - it.start), 0);
}

function overlapSeconds(a: Interval[], b: Interval[]): number {
  let i = 0;
  let j = 0;
  let acc = 0;

  while (i < a.length && j < b.length) {
    const x = a[i];
    const y = b[j];
    if (!x || !y) break;

    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (end > start) {
      acc += end - start;
    }

    if (x.end <= y.end) {
      i++;
    } else {
      j++;
    }
  }

  return acc;
}

function ensureInterval(interval: Interval): Interval | null {
  if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end)) return null;
  if (interval.end <= interval.start) return null;
  return interval;
}

function pushMergedInterval(intervals: Interval[], next: Interval): void {
  const last = intervals[intervals.length - 1];
  if (last && next.start <= last.end) {
    last.end = Math.max(last.end, next.end);
    return;
  }
  intervals.push({ start: next.start, end: next.end });
}

function buildUnknownIntervals(
  rangeStart: number,
  rangeEnd: number,
  intervalSec: number,
  checks: Array<{ checked_at: number; status: string }>
): Interval[] {
  if (rangeEnd <= rangeStart) return [];
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    return [{ start: rangeStart, end: rangeEnd }];
  }

  let lastCheck: { checked_at: number; status: string } | null = null;
  let cursor = rangeStart;

  const unknown: Interval[] = [];

  function addUnknown(from: number, to: number) {
    const it = ensureInterval({ start: from, end: to });
    if (!it) return;
    pushMergedInterval(unknown, it);
  }

  function processSegment(segStart: number, segEnd: number) {
    if (segEnd <= segStart) return;

    if (!lastCheck) {
      addUnknown(segStart, segEnd);
      return;
    }

    const validUntil = lastCheck.checked_at + intervalSec * 2;

    // Allow up to 2x interval jitter before treating gaps as UNKNOWN (matches status-page stale threshold).
    if (segStart >= validUntil) {
      addUnknown(segStart, segEnd);
      return;
    }

    const coveredEnd = Math.min(segEnd, validUntil);
    if (lastCheck.status === 'unknown') {
      addUnknown(segStart, coveredEnd);
    }

    if (coveredEnd < segEnd) {
      addUnknown(coveredEnd, segEnd);
    }
  }

  for (const check of checks) {
    if (check.checked_at < rangeStart) {
      lastCheck = check;
      continue;
    }
    if (check.checked_at >= rangeEnd) {
      break;
    }

    processSegment(cursor, check.checked_at);
    lastCheck = check;
    cursor = check.checked_at;
  }

  processSegment(cursor, rangeEnd);
  return unknown;
}

function rangeToSeconds(range: z.infer<typeof uptimeRangeSchema> | z.infer<typeof latencyRangeSchema>): number {
  switch (range) {
    case '24h':
      return 24 * 60 * 60;
    case '7d':
      return 7 * 24 * 60 * 60;
    case '30d':
      return 30 * 24 * 60 * 60;
    default: {
      const _exhaustive: never = range;
      return _exhaustive;
    }
  }
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1));
  return sorted[idx] ?? null;
}

type IncidentRow = {
  id: number;
  title: string;
  status: string;
  impact: string;
  message: string | null;
  started_at: number;
  resolved_at: number | null;
};

type IncidentUpdateRow = {
  id: number;
  incident_id: number;
  status: string | null;
  message: string;
  created_at: number;
};

type IncidentMonitorLinkRow = {
  incident_id: number;
  monitor_id: number;
};

function toIncidentStatus(value: string | null): 'investigating' | 'identified' | 'monitoring' | 'resolved' {
  switch (value) {
    case 'investigating':
    case 'identified':
    case 'monitoring':
    case 'resolved':
      return value;
    default:
      return 'investigating';
  }
}

function toIncidentImpact(value: string | null): 'none' | 'minor' | 'major' | 'critical' {
  switch (value) {
    case 'none':
    case 'minor':
    case 'major':
    case 'critical':
      return value;
    default:
      return 'minor';
  }
}

function incidentUpdateRowToApi(row: IncidentUpdateRow) {
  return {
    id: row.id,
    incident_id: row.incident_id,
    status: row.status === null ? null : toIncidentStatus(row.status),
    message: row.message,
    created_at: row.created_at,
  };
}

function incidentRowToApi(row: IncidentRow, updates: IncidentUpdateRow[] = [], monitorIds: number[] = []) {
  return {
    id: row.id,
    title: row.title,
    status: toIncidentStatus(row.status),
    impact: toIncidentImpact(row.impact),
    message: row.message,
    started_at: row.started_at,
    resolved_at: row.resolved_at,
    monitor_ids: monitorIds,
    updates: updates.map(incidentUpdateRowToApi),
  };
}

async function listIncidentUpdatesByIncidentId(
  db: D1Database,
  incidentIds: number[]
): Promise<Map<number, IncidentUpdateRow[]>> {
  const byIncident = new Map<number, IncidentUpdateRow[]>();
  if (incidentIds.length === 0) return byIncident;

  const placeholders = incidentIds.map((_, idx) => `?${idx + 1}`).join(', ');
  const sql = `
    SELECT id, incident_id, status, message, created_at
    FROM incident_updates
    WHERE incident_id IN (${placeholders})
    ORDER BY incident_id, created_at, id
  `;

  const { results } = await db.prepare(sql).bind(...incidentIds).all<IncidentUpdateRow>();
  for (const r of results ?? []) {
    const existing = byIncident.get(r.incident_id) ?? [];
    existing.push(r);
    byIncident.set(r.incident_id, existing);
  }

  return byIncident;
}

async function listIncidentMonitorIdsByIncidentId(db: D1Database, incidentIds: number[]): Promise<Map<number, number[]>> {
  const byIncident = new Map<number, number[]>();
  if (incidentIds.length === 0) return byIncident;

  const placeholders = incidentIds.map((_, idx) => `?${idx + 1}`).join(', ');
  const sql = `
    SELECT incident_id, monitor_id
    FROM incident_monitors
    WHERE incident_id IN (${placeholders})
    ORDER BY incident_id, monitor_id
  `;

  const { results } = await db.prepare(sql).bind(...incidentIds).all<IncidentMonitorLinkRow>();
  for (const r of results ?? []) {
    const existing = byIncident.get(r.incident_id) ?? [];
    existing.push(r.monitor_id);
    byIncident.set(r.incident_id, existing);
  }

  return byIncident;
}

publicRoutes.get('/status', async (c) => {
  const now = Math.floor(Date.now() / 1000);

  const snapshot = await readStatusSnapshot(c.env.DB, now);
  if (snapshot) {
    const res = c.json(snapshot.data);
    applyStatusCacheHeaders(res, snapshot.age);

    // If we're close to the freshness boundary, trigger a background refresh.
    if (snapshot.age >= 30) {
      c.executionCtx.waitUntil(
        (async () => {
          const refreshedAt = Math.floor(Date.now() / 1000);
          const payload = await computePublicStatusPayload(c.env.DB, refreshedAt);
          await writeStatusSnapshot(c.env.DB, refreshedAt, payload);
        })().catch((err) => {
          console.warn('public snapshot: refresh failed', err);
        }),
      );
    }

    return res;
  }

  const payload = await computePublicStatusPayload(c.env.DB, now);
  const res = c.json(payload);
  applyStatusCacheHeaders(res, 0);

  c.executionCtx.waitUntil(
    writeStatusSnapshot(c.env.DB, now, payload).catch((err) => {
      console.warn('public snapshot: write failed', err);
    }),
  );

  return res;
});

publicRoutes.get('/incidents', async (c) => {
  const limit = z.coerce.number().int().min(1).max(200).optional().default(20).parse(c.req.query('limit'));
  const cursor = z.coerce.number().int().positive().optional().parse(c.req.query('cursor'));

  const { results: activeRows } = await c.env.DB.prepare(
    `
      SELECT id, title, status, impact, message, started_at, resolved_at
      FROM incidents
      WHERE status != 'resolved'
      ORDER BY started_at DESC, id DESC
      LIMIT ?1
    `
  )
    .bind(limit)
    .all<IncidentRow>();

  const active = activeRows ?? [];
  const remaining = Math.max(0, limit - active.length);

  let resolved: IncidentRow[] = [];
  let next_cursor: number | null = null;

  if (remaining > 0) {
    const resolvedLimitPlusOne = remaining + 1;

    const baseSql = `
      SELECT id, title, status, impact, message, started_at, resolved_at
      FROM incidents
      WHERE status = 'resolved'
    `;

    const { results: resolvedRows } = cursor
      ? await c.env.DB.prepare(
          `
            ${baseSql}
              AND id < ?2
            ORDER BY id DESC
            LIMIT ?1
          `
        )
          .bind(resolvedLimitPlusOne, cursor)
          .all<IncidentRow>()
      : await c.env.DB.prepare(
          `
            ${baseSql}
            ORDER BY id DESC
            LIMIT ?1
          `
        )
          .bind(resolvedLimitPlusOne)
          .all<IncidentRow>();

    const allResolved = resolvedRows ?? [];
    resolved = allResolved.slice(0, remaining);

    if (allResolved.length > remaining) {
      const last = resolved[resolved.length - 1];
      next_cursor = last ? last.id : null;
    }
  }

  const combined = [...active, ...resolved];
  const updatesByIncidentId = await listIncidentUpdatesByIncidentId(
    c.env.DB,
    combined.map((r) => r.id)
  );
  const monitorIdsByIncidentId = await listIncidentMonitorIdsByIncidentId(
    c.env.DB,
    combined.map((r) => r.id)
  );

  return c.json({
    incidents: combined.map((r) =>
      incidentRowToApi(r, updatesByIncidentId.get(r.id) ?? [], monitorIdsByIncidentId.get(r.id) ?? [])
    ),
    next_cursor,
  });
});

publicRoutes.get('/monitors/:id/latency', async (c) => {
  const id = z.coerce.number().int().positive().parse(c.req.param('id'));
  const range = latencyRangeSchema.optional().default('24h').parse(c.req.query('range'));

  const monitor = await c.env.DB.prepare(
    `
      SELECT id, name
      FROM monitors
      WHERE id = ?1 AND is_active = 1
    `
  )
    .bind(id)
    .first<{ id: number; name: string }>();

  if (!monitor) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
  }

  const now = Math.floor(Date.now() / 1000);
  const rangeEnd = Math.floor(now / 60) * 60;
  const rangeStart = rangeEnd - rangeToSeconds(range);

  const { results } = await c.env.DB.prepare(
    `
      SELECT checked_at, status, latency_ms
      FROM check_results
      WHERE monitor_id = ?1
        AND checked_at >= ?2
        AND checked_at <= ?3
      ORDER BY checked_at
    `
  )
    .bind(id, rangeStart, rangeEnd)
    .all<{ checked_at: number; status: string; latency_ms: number | null }>();

  const points = (results ?? []).map((r) => ({
    checked_at: r.checked_at,
    status: toCheckStatus(r.status),
    latency_ms: r.latency_ms,
  }));

  const upLatencies = points
    .filter((p) => p.status === 'up' && typeof p.latency_ms === 'number')
    .map((p) => p.latency_ms as number);

  const avg_latency_ms =
    upLatencies.length === 0
      ? null
      : Math.round(upLatencies.reduce((acc, v) => acc + v, 0) / upLatencies.length);

  return c.json({
    monitor: { id: monitor.id, name: monitor.name },
    range,
    range_start_at: rangeStart,
    range_end_at: rangeEnd,
    avg_latency_ms,
    p95_latency_ms: p95(upLatencies),
    points,
  });
});

type OutageRow = { started_at: number; ended_at: number | null };

publicRoutes.get('/monitors/:id/uptime', async (c) => {
  const id = z.coerce.number().int().positive().parse(c.req.param('id'));
  const range = uptimeRangeSchema.optional().default('24h').parse(c.req.query('range'));

  const monitor = await c.env.DB.prepare(
    `
      SELECT id, name, interval_sec, created_at
      FROM monitors
      WHERE id = ?1 AND is_active = 1
    `
  )
    .bind(id)
    .first<{ id: number; name: string; interval_sec: number; created_at: number }>();

  if (!monitor) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
  }

  const now = Math.floor(Date.now() / 1000);
  const rangeEnd = Math.floor(now / 60) * 60;
  const requestedRangeStart = rangeEnd - rangeToSeconds(range);
  const rangeStart = Math.max(requestedRangeStart, monitor.created_at);

  const total_sec = Math.max(0, rangeEnd - rangeStart);

  const { results: outageRows } = await c.env.DB.prepare(
    `
      SELECT started_at, ended_at
      FROM outages
      WHERE monitor_id = ?1
        AND started_at < ?2
        AND (ended_at IS NULL OR ended_at > ?3)
      ORDER BY started_at
    `
  )
    .bind(id, rangeEnd, rangeStart)
    .all<OutageRow>();

  const downtimeIntervals = mergeIntervals(
    (outageRows ?? [])
      .map((r) => {
        const start = Math.max(r.started_at, rangeStart);
        const end = Math.min(r.ended_at ?? rangeEnd, rangeEnd);
        return { start, end };
      })
      .filter((it) => it.end > it.start)
  );
  const downtime_sec = sumIntervals(downtimeIntervals);

  const checksStart = rangeStart - monitor.interval_sec * 2;
  const { results: checkRows } = await c.env.DB.prepare(
    `
      SELECT checked_at, status
      FROM check_results
      WHERE monitor_id = ?1
        AND checked_at >= ?2
        AND checked_at < ?3
      ORDER BY checked_at
    `
  )
    .bind(id, checksStart, rangeEnd)
    .all<{ checked_at: number; status: string }>();

  const unknownIntervals = buildUnknownIntervals(
    rangeStart,
    rangeEnd,
    monitor.interval_sec,
    (checkRows ?? []).map((r) => ({ checked_at: r.checked_at, status: toCheckStatus(r.status) }))
  );

  // Unknown time is treated as "unavailable" per Application.md; exclude overlap with downtime to avoid double counting.
  const unknown_sec = Math.max(
    0,
    sumIntervals(unknownIntervals) - overlapSeconds(unknownIntervals, downtimeIntervals)
  );

  const unavailable_sec = Math.min(total_sec, downtime_sec + unknown_sec);
  const uptime_sec = Math.max(0, total_sec - unavailable_sec);
  const uptime_pct = total_sec === 0 ? 0 : (uptime_sec / total_sec) * 100;

  return c.json({
    monitor: { id: monitor.id, name: monitor.name },
    range,
    range_start_at: rangeStart,
    range_end_at: rangeEnd,
    total_sec,
    downtime_sec,
    unknown_sec,
    uptime_sec,
    uptime_pct,
  });
});

publicRoutes.get('/analytics/uptime', async (c) => {
  const range = uptimeOverviewRangeSchema.optional().default('30d').parse(c.req.query('range'));

  const now = Math.floor(Date.now() / 1000);
  const rangeEnd = Math.floor(now / 86400) * 86400; // full days only (UTC)
  const rangeStart = rangeEnd - (range === '30d' ? 30 * 86400 : 90 * 86400);

  const { results: monitorRows } = await c.env.DB.prepare(
    `
      SELECT id, name, type
      FROM monitors
      WHERE is_active = 1
      ORDER BY id
    `
  ).all<{ id: number; name: string; type: string }>();

  const monitors = monitorRows ?? [];

  const { results: sumRows } = await c.env.DB.prepare(
    `
      SELECT
        monitor_id,
        SUM(total_sec) AS total_sec,
        SUM(downtime_sec) AS downtime_sec,
        SUM(unknown_sec) AS unknown_sec,
        SUM(uptime_sec) AS uptime_sec
      FROM monitor_daily_rollups
      WHERE day_start_at >= ?1 AND day_start_at < ?2
      GROUP BY monitor_id
    `
  )
    .bind(rangeStart, rangeEnd)
    .all<{
      monitor_id: number;
      total_sec: number;
      downtime_sec: number;
      unknown_sec: number;
      uptime_sec: number;
    }>();

  const byMonitorId = new Map<
    number,
    { total_sec: number; downtime_sec: number; unknown_sec: number; uptime_sec: number }
  >();
  for (const r of sumRows ?? []) {
    byMonitorId.set(r.monitor_id, {
      total_sec: r.total_sec ?? 0,
      downtime_sec: r.downtime_sec ?? 0,
      unknown_sec: r.unknown_sec ?? 0,
      uptime_sec: r.uptime_sec ?? 0,
    });
  }

  let total_sec = 0;
  let downtime_sec = 0;
  let unknown_sec = 0;
  let uptime_sec = 0;

  const out = monitors.map((m) => {
    const totals = byMonitorId.get(m.id) ?? { total_sec: 0, downtime_sec: 0, unknown_sec: 0, uptime_sec: 0 };
    total_sec += totals.total_sec;
    downtime_sec += totals.downtime_sec;
    unknown_sec += totals.unknown_sec;
    uptime_sec += totals.uptime_sec;
    const uptime_pct = totals.total_sec === 0 ? 0 : (totals.uptime_sec / totals.total_sec) * 100;
    return {
      id: m.id,
      name: m.name,
      type: m.type,
      total_sec: totals.total_sec,
      downtime_sec: totals.downtime_sec,
      unknown_sec: totals.unknown_sec,
      uptime_sec: totals.uptime_sec,
      uptime_pct,
    };
  });

  const overall_uptime_pct = total_sec === 0 ? 0 : (uptime_sec / total_sec) * 100;

  return c.json({
    generated_at: now,
    range,
    range_start_at: rangeStart,
    range_end_at: rangeEnd,
    overall: { total_sec, downtime_sec, unknown_sec, uptime_sec, uptime_pct: overall_uptime_pct },
    monitors: out,
  });
});

publicRoutes.get('/monitors/:id/outages', async (c) => {
  const id = z.coerce.number().int().positive().parse(c.req.param('id'));
  const range = z.enum(['30d']).optional().default('30d').parse(c.req.query('range'));
  const limit = z.coerce.number().int().min(1).max(200).optional().default(200).parse(c.req.query('limit'));
  const cursor = z.coerce.number().int().positive().optional().parse(c.req.query('cursor'));

  const monitor = await c.env.DB
    .prepare('SELECT id, created_at FROM monitors WHERE id = ?1 AND is_active = 1')
    .bind(id)
    .first<{ id: number; created_at: number }>();
  if (!monitor) {
    throw new AppError(404, 'NOT_FOUND', 'Monitor not found');
  }

  const now = Math.floor(Date.now() / 1000);
  const rangeEnd = Math.floor(now / 86400) * 86400; // full days only (UTC)
  const rangeStart = Math.max(rangeEnd - 30 * 86400, monitor.created_at);

  const sqlBase = `
    SELECT id, started_at, ended_at, initial_error, last_error
    FROM outages
    WHERE monitor_id = ?1
      AND started_at < ?2
      AND (ended_at IS NULL OR ended_at > ?3)
  `;

  const take = limit + 1;
  const { results } = cursor
    ? await c.env.DB
        .prepare(
          `
            ${sqlBase}
              AND id < ?4
            ORDER BY id DESC
            LIMIT ?5
          `
        )
        .bind(id, rangeEnd, rangeStart, cursor, take)
        .all<{ id: number; started_at: number; ended_at: number | null; initial_error: string | null; last_error: string | null }>()
    : await c.env.DB
        .prepare(
          `
            ${sqlBase}
            ORDER BY id DESC
            LIMIT ?4
          `
        )
        .bind(id, rangeEnd, rangeStart, take)
        .all<{ id: number; started_at: number; ended_at: number | null; initial_error: string | null; last_error: string | null }>();

  const rows = results ?? [];
  const page = rows.slice(0, limit);
  const next_cursor = rows.length > limit ? page[page.length - 1]?.id ?? null : null;

  return c.json({
    range: range as '30d',
    range_start_at: rangeStart,
    range_end_at: rangeEnd,
    outages: page.map((r) => ({
      id: r.id,
      monitor_id: id,
      started_at: r.started_at,
      ended_at: r.ended_at,
      initial_error: r.initial_error,
      last_error: r.last_error,
    })),
    next_cursor,
  });
});
publicRoutes.get('/health', async (c) => {
  // Minimal DB touch to verify the Worker can connect to D1.
  const db = getDb(c.env);
  await db.select({ id: monitors.id }).from(monitors).limit(1).all();
  return c.json({ ok: true });
});


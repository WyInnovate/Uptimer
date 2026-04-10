import type { PublicHomepageResponse } from '../schemas/public-homepage';

import {
  buildPublicStatusBanner,
  computeTodayPartialUptimeBatch,
  listIncidentMonitorIdsByIncidentId,
  listMaintenanceWindowMonitorIdsByWindowId,
  listVisibleActiveIncidents,
  listVisibleMaintenanceWindows,
  readPublicSiteSettings,
  toIncidentImpact,
  toIncidentStatus,
  toMonitorStatus,
  toUptimePct,
  utcDayStart,
  type IncidentRow,
  type MaintenanceWindowRow,
  type UptimeWindowTotals,
} from './data';
import {
  buildNumberedPlaceholders,
  chunkPositiveIntegerIds,
  filterStatusPageScopedMonitorIds,
  incidentStatusPageVisibilityPredicate,
  listStatusPageVisibleMonitorIds,
  maintenanceWindowStatusPageVisibilityPredicate,
  monitorVisibilityPredicate,
  shouldIncludeStatusPageScopedItem,
} from './visibility';

const PREVIEW_BATCH_LIMIT = 50;
const UPTIME_DAYS = 30;
const HEARTBEAT_POINTS = 60;

type IncidentSummary = PublicHomepageResponse['active_incidents'][number];
type MaintenancePreview = NonNullable<PublicHomepageResponse['maintenance_history_preview']>;
type HomepageMonitorCard = PublicHomepageResponse['monitors'][number];
type HomepageMonitorStatus = HomepageMonitorCard['status'];

type HomepageMonitorRow = {
  id: number;
  name: string;
  type: string;
  group_name: string | null;
  interval_sec: number;
  created_at: number;
  state_status: string | null;
  last_checked_at: number | null;
};

type HomepageHeartbeatRow = {
  monitor_id: number;
  checked_at: number;
  status: string;
  latency_ms: number | null;
};

type HomepageRollupRow = {
  monitor_id: number;
  day_start_at: number;
  total_sec: number;
  downtime_sec: number;
  unknown_sec: number;
  uptime_sec: number;
};

function toHeartbeatStatusCode(status: string | null | undefined): string {
  switch (status) {
    case 'up':
      return 'u';
    case 'down':
      return 'd';
    case 'maintenance':
      return 'm';
    case 'unknown':
    default:
      return 'x';
  }
}

function toIncidentSummary(row: IncidentRow): IncidentSummary {
  return {
    id: row.id,
    title: row.title,
    status: toIncidentStatus(row.status),
    impact: toIncidentImpact(row.impact),
    message: row.message,
    started_at: row.started_at,
    resolved_at: row.resolved_at,
  };
}

function toMaintenancePreview(
  row: MaintenanceWindowRow,
  monitorIds: number[],
): MaintenancePreview {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    monitor_ids: monitorIds,
  };
}

async function readHomepageUptimeRatingLevel(db: D1Database): Promise<1 | 2 | 3 | 4 | 5> {
  const row = await db
    .prepare('SELECT value FROM settings WHERE key = ?1')
    .bind('uptime_rating_level')
    .first<{ value: string }>();

  const raw = row?.value ?? '';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 5) {
    return parsed as 1 | 2 | 3 | 4 | 5;
  }
  return 3;
}

async function listHomepageMaintenanceMonitorIds(
  db: D1Database,
  at: number,
  monitorIds: number[],
): Promise<Set<number>> {
  const activeMonitorIds = new Set<number>();

  for (const ids of chunkPositiveIntegerIds(monitorIds)) {
    const placeholders = buildNumberedPlaceholders(ids.length, 2);
    const sql = `
      SELECT DISTINCT mwm.monitor_id
      FROM maintenance_window_monitors mwm
      JOIN maintenance_windows mw ON mw.id = mwm.maintenance_window_id
      WHERE mw.starts_at <= ?1 AND mw.ends_at > ?1
        AND mwm.monitor_id IN (${placeholders})
    `;

    const { results } = await db
      .prepare(sql)
      .bind(at, ...ids)
      .all<{ monitor_id: number }>();
    for (const row of results ?? []) {
      activeMonitorIds.add(row.monitor_id);
    }
  }

  return activeMonitorIds;
}

function computeOverallStatus(summary: PublicHomepageResponse['summary']): HomepageMonitorStatus {
  if (summary.down > 0) return 'down';
  if (summary.unknown > 0) return 'unknown';
  if (summary.maintenance > 0) return 'maintenance';
  if (summary.up > 0) return 'up';
  if (summary.paused > 0) return 'paused';
  return 'unknown';
}

function toHomepageMonitorType(value: string): HomepageMonitorCard['type'] {
  return value === 'tcp' ? 'tcp' : 'http';
}

function toHomepageMonitorCard(
  row: HomepageMonitorRow,
  now: number,
  maintenanceMonitorIds: ReadonlySet<number>,
): HomepageMonitorCard {
  const isInMaintenance = maintenanceMonitorIds.has(row.id);
  const stateStatus = toMonitorStatus(row.state_status);
  const isStale =
    isInMaintenance || stateStatus === 'paused' || stateStatus === 'maintenance'
      ? false
      : row.last_checked_at === null
        ? true
        : now - row.last_checked_at > row.interval_sec * 2;

  return {
    id: row.id,
    name: row.name,
    type: toHomepageMonitorType(row.type),
    group_name: row.group_name?.trim() ? row.group_name.trim() : null,
    status: isInMaintenance ? 'maintenance' : isStale ? 'unknown' : stateStatus,
    is_stale: isStale,
    last_checked_at: row.last_checked_at,
    heartbeat_strip: {
      checked_at: [],
      status_codes: '',
      latency_ms: [],
    },
    uptime_30d: null,
    uptime_day_strip: {
      day_start_at: [],
      downtime_sec: [],
      unknown_sec: [],
      uptime_pct_milli: [],
    },
  };
}

function addUptimeDay(
  monitor: HomepageMonitorCard,
  totals: { totalSec: number; uptimeSec: number },
  dayStartAt: number,
  uptime: UptimeWindowTotals,
): void {
  monitor.uptime_day_strip.day_start_at.push(dayStartAt);
  monitor.uptime_day_strip.downtime_sec.push(uptime.downtime_sec);
  monitor.uptime_day_strip.unknown_sec.push(uptime.unknown_sec);
  monitor.uptime_day_strip.uptime_pct_milli.push(
    uptime.uptime_pct === null ? null : Math.round(uptime.uptime_pct * 1000),
  );
  totals.totalSec += uptime.total_sec;
  totals.uptimeSec += uptime.uptime_sec;
}

async function buildHomepageMonitorData(
  db: D1Database,
  now: number,
  includeHiddenMonitors: boolean,
): Promise<{
  monitors: HomepageMonitorCard[];
  summary: PublicHomepageResponse['summary'];
  overallStatus: HomepageMonitorStatus;
  uptimeRatingLevel: 1 | 2 | 3 | 4 | 5;
}> {
  const rangeEndFullDays = utcDayStart(now);
  const rangeEnd = now;
  const { results } = await db
    .prepare(
      `
      SELECT
        m.id,
        m.name,
        m.type,
        m.group_name,
        m.interval_sec,
        m.created_at,
        s.status AS state_status,
        s.last_checked_at
      FROM monitors m
      LEFT JOIN monitor_state s ON s.monitor_id = m.id
      WHERE m.is_active = 1
        AND ${monitorVisibilityPredicate(includeHiddenMonitors, 'm')}
      ORDER BY
        m.group_sort_order ASC,
        lower(
          CASE
            WHEN m.group_name IS NULL OR trim(m.group_name) = '' THEN 'Ungrouped'
            ELSE trim(m.group_name)
          END
        ) ASC,
        m.sort_order ASC,
        m.id ASC
    `,
    )
    .all<HomepageMonitorRow>();

  const rawMonitors = results ?? [];
  const ids = rawMonitors.map((monitor) => monitor.id);
  const earliestCreatedAt = rawMonitors.reduce(
    (acc, monitor) => Math.min(acc, monitor.created_at),
    Number.POSITIVE_INFINITY,
  );
  const rangeStart = Number.isFinite(earliestCreatedAt)
    ? Math.max(rangeEnd - UPTIME_DAYS * 86400, earliestCreatedAt)
    : rangeEnd - UPTIME_DAYS * 86400;

  const [maintenanceMonitorIds, uptimeRatingLevel] = await Promise.all([
    listHomepageMaintenanceMonitorIds(db, now, ids),
    readHomepageUptimeRatingLevel(db),
  ]);

  const summary: PublicHomepageResponse['summary'] = {
    up: 0,
    down: 0,
    maintenance: 0,
    paused: 0,
    unknown: 0,
  };

  const monitors = new Array<HomepageMonitorCard>(rawMonitors.length);
  const monitorIndexById = new Map<number, number>();
  for (let index = 0; index < rawMonitors.length; index += 1) {
    const monitor = toHomepageMonitorCard(rawMonitors[index], now, maintenanceMonitorIds);
    monitors[index] = monitor;
    monitorIndexById.set(monitor.id, index);
    summary[monitor.status] += 1;
  }

  if (ids.length === 0) {
    return {
      monitors,
      summary,
      overallStatus: computeOverallStatus(summary),
      uptimeRatingLevel,
    };
  }

  const placeholders = buildNumberedPlaceholders(ids.length);
  const todayStartAt = utcDayStart(now);
  const needsToday = rangeEnd > rangeEndFullDays && todayStartAt >= rangeStart;

  const heartbeatRowsPromise = db
    .prepare(
      `
      SELECT monitor_id, checked_at, status, latency_ms
      FROM (
        SELECT
          id,
          monitor_id,
          checked_at,
          status,
          latency_ms,
          ROW_NUMBER() OVER (
            PARTITION BY monitor_id
            ORDER BY checked_at DESC, id DESC
          ) AS rn
        FROM check_results
        WHERE monitor_id IN (${placeholders})
      )
      WHERE rn <= ?${ids.length + 1}
      ORDER BY monitor_id, checked_at DESC, id DESC
    `,
    )
    .bind(...ids, HEARTBEAT_POINTS)
    .all<HomepageHeartbeatRow>()
    .then(({ results: rows }) => rows ?? []);

  const rollupRowsPromise = db
    .prepare(
      `
      SELECT monitor_id, day_start_at, total_sec, downtime_sec, unknown_sec, uptime_sec
      FROM monitor_daily_rollups
      WHERE monitor_id IN (${placeholders})
        AND day_start_at >= ?${ids.length + 1}
        AND day_start_at < ?${ids.length + 2}
      ORDER BY monitor_id, day_start_at
    `,
    )
    .bind(...ids, rangeStart, rangeEndFullDays)
    .all<HomepageRollupRow>()
    .then(({ results: rows }) => rows ?? []);

  const todayByMonitorIdPromise: Promise<Map<number, UptimeWindowTotals>> = needsToday
    ? computeTodayPartialUptimeBatch(
        db,
        rawMonitors.map((monitor) => ({
          id: monitor.id,
          interval_sec: monitor.interval_sec,
          created_at: monitor.created_at,
          last_checked_at: monitor.last_checked_at,
        })),
        Math.max(todayStartAt, rangeStart),
        rangeEnd,
      )
    : Promise.resolve(new Map<number, UptimeWindowTotals>());

  const [heartbeatRows, rollupRows, todayByMonitorId] = await Promise.all([
    heartbeatRowsPromise,
    rollupRowsPromise,
    todayByMonitorIdPromise,
  ]);

  const heartbeatStatusCodes = Array.from({ length: monitors.length }, () => [] as string[]);
  for (const row of heartbeatRows) {
    const index = monitorIndexById.get(row.monitor_id);
    if (index === undefined) continue;

    const monitor = monitors[index];
    monitor.heartbeat_strip.checked_at.push(row.checked_at);
    monitor.heartbeat_strip.latency_ms.push(row.latency_ms);
    heartbeatStatusCodes[index].push(toHeartbeatStatusCode(row.status));
  }

  const totalsByMonitor = Array.from({ length: monitors.length }, () => ({
    totalSec: 0,
    uptimeSec: 0,
  }));
  for (const row of rollupRows) {
    const index = monitorIndexById.get(row.monitor_id);
    if (index === undefined) continue;

    addUptimeDay(monitors[index], totalsByMonitor[index], row.day_start_at, {
      total_sec: row.total_sec ?? 0,
      downtime_sec: row.downtime_sec ?? 0,
      unknown_sec: row.unknown_sec ?? 0,
      uptime_sec: row.uptime_sec ?? 0,
    });
  }

  if (needsToday) {
    for (const [monitorId, today] of todayByMonitorId) {
      const index = monitorIndexById.get(monitorId);
      if (index === undefined) continue;
      addUptimeDay(monitors[index], totalsByMonitor[index], todayStartAt, today);
    }
  }

  for (let index = 0; index < monitors.length; index += 1) {
    monitors[index].heartbeat_strip.status_codes = heartbeatStatusCodes[index].join('');

    const totals = totalsByMonitor[index];
    monitors[index].uptime_30d =
      totals.totalSec === 0
        ? null
        : {
            uptime_pct: (totals.uptimeSec / totals.totalSec) * 100,
          };
  }

  return {
    monitors,
    summary,
    overallStatus: computeOverallStatus(summary),
    uptimeRatingLevel,
  };
}

async function findLatestVisibleResolvedIncident(
  db: D1Database,
  includeHiddenMonitors: boolean,
): Promise<IncidentRow | null> {
  const incidentVisibilitySql = incidentStatusPageVisibilityPredicate(includeHiddenMonitors);
  let cursor: number | null = null;

  while (true) {
    const queryResult: { results: IncidentRow[] | undefined } = cursor
      ? await db
          .prepare(
            `
            SELECT id, title, status, impact, message, started_at, resolved_at
            FROM incidents
            WHERE status = 'resolved'
              AND ${incidentVisibilitySql}
              AND id < ?2
            ORDER BY id DESC
            LIMIT ?1
          `,
          )
          .bind(PREVIEW_BATCH_LIMIT, cursor)
          .all<IncidentRow>()
      : await db
          .prepare(
            `
            SELECT id, title, status, impact, message, started_at, resolved_at
            FROM incidents
            WHERE status = 'resolved'
              AND ${incidentVisibilitySql}
            ORDER BY id DESC
            LIMIT ?1
          `,
          )
          .bind(PREVIEW_BATCH_LIMIT)
          .all<IncidentRow>();

    const rows: IncidentRow[] = queryResult.results ?? [];
    if (rows.length === 0) return null;

    const monitorIdsByIncidentId = await listIncidentMonitorIdsByIncidentId(
      db,
      rows.map((row) => row.id),
    );
    const visibleMonitorIds = includeHiddenMonitors
      ? new Set<number>()
      : await listStatusPageVisibleMonitorIds(
          db,
          [...monitorIdsByIncidentId.values()].flat(),
        );

    for (const row of rows) {
      const originalMonitorIds = monitorIdsByIncidentId.get(row.id) ?? [];
      const filteredMonitorIds = filterStatusPageScopedMonitorIds(
        originalMonitorIds,
        visibleMonitorIds,
        includeHiddenMonitors,
      );

      if (shouldIncludeStatusPageScopedItem(originalMonitorIds, filteredMonitorIds)) {
        return row;
      }
    }

    if (rows.length < PREVIEW_BATCH_LIMIT) {
      return null;
    }

    cursor = rows[rows.length - 1]?.id ?? null;
  }
}

async function findLatestVisibleHistoricalMaintenanceWindow(
  db: D1Database,
  now: number,
  includeHiddenMonitors: boolean,
): Promise<{ row: MaintenanceWindowRow; monitorIds: number[] } | null> {
  const maintenanceVisibilitySql = maintenanceWindowStatusPageVisibilityPredicate(
    includeHiddenMonitors,
  );
  let cursor: number | null = null;

  while (true) {
    const queryResult: { results: MaintenanceWindowRow[] | undefined } = cursor
      ? await db
          .prepare(
            `
            SELECT id, title, message, starts_at, ends_at, created_at
            FROM maintenance_windows
            WHERE ends_at <= ?1
              AND ${maintenanceVisibilitySql}
              AND id < ?3
            ORDER BY id DESC
            LIMIT ?2
          `,
          )
          .bind(now, PREVIEW_BATCH_LIMIT, cursor)
          .all<MaintenanceWindowRow>()
      : await db
          .prepare(
            `
            SELECT id, title, message, starts_at, ends_at, created_at
            FROM maintenance_windows
            WHERE ends_at <= ?1
              AND ${maintenanceVisibilitySql}
            ORDER BY id DESC
            LIMIT ?2
          `,
          )
          .bind(now, PREVIEW_BATCH_LIMIT)
          .all<MaintenanceWindowRow>();

    const rows: MaintenanceWindowRow[] = queryResult.results ?? [];
    if (rows.length === 0) return null;

    const monitorIdsByWindowId = await listMaintenanceWindowMonitorIdsByWindowId(
      db,
      rows.map((row) => row.id),
    );
    const visibleMonitorIds = includeHiddenMonitors
      ? new Set<number>()
      : await listStatusPageVisibleMonitorIds(
          db,
          [...monitorIdsByWindowId.values()].flat(),
        );

    for (const row of rows) {
      const originalMonitorIds = monitorIdsByWindowId.get(row.id) ?? [];
      const filteredMonitorIds = filterStatusPageScopedMonitorIds(
        originalMonitorIds,
        visibleMonitorIds,
        includeHiddenMonitors,
      );

      if (shouldIncludeStatusPageScopedItem(originalMonitorIds, filteredMonitorIds)) {
        return { row, monitorIds: filteredMonitorIds };
      }
    }

    if (rows.length < PREVIEW_BATCH_LIMIT) {
      return null;
    }

    cursor = rows[rows.length - 1]?.id ?? null;
  }
}

export async function computePublicHomepagePayload(
  db: D1Database,
  now: number,
): Promise<PublicHomepageResponse> {
  const includeHiddenMonitors = false;

  const [
    monitorData,
    activeIncidents,
    maintenanceWindows,
    settings,
    resolvedIncidentPreview,
    maintenanceHistoryPreview,
  ] = await Promise.all([
    buildHomepageMonitorData(db, now, includeHiddenMonitors),
    listVisibleActiveIncidents(db, includeHiddenMonitors),
    listVisibleMaintenanceWindows(db, now, includeHiddenMonitors),
    readPublicSiteSettings(db),
    findLatestVisibleResolvedIncident(db, includeHiddenMonitors),
    findLatestVisibleHistoricalMaintenanceWindow(db, now, includeHiddenMonitors),
  ]);

  const activeIncidentSummaries = new Array<IncidentSummary>(activeIncidents.length);
  for (let index = 0; index < activeIncidents.length; index += 1) {
    const incident = activeIncidents[index];
    if (!incident) continue;
    activeIncidentSummaries[index] = toIncidentSummary(incident.row);
  }

  const activeMaintenancePreview = new Array<MaintenancePreview>(maintenanceWindows.active.length);
  for (let index = 0; index < maintenanceWindows.active.length; index += 1) {
    const window = maintenanceWindows.active[index];
    if (!window) continue;
    activeMaintenancePreview[index] = toMaintenancePreview(window.row, window.monitorIds);
  }

  const upcomingMaintenancePreview = new Array<MaintenancePreview>(
    maintenanceWindows.upcoming.length,
  );
  for (let index = 0; index < maintenanceWindows.upcoming.length; index += 1) {
    const window = maintenanceWindows.upcoming[index];
    if (!window) continue;
    upcomingMaintenancePreview[index] = toMaintenancePreview(window.row, window.monitorIds);
  }

  return {
    generated_at: now,
    bootstrap_mode: 'full',
    monitor_count_total: monitorData.monitors.length,
    site_title: settings.site_title,
    site_description: settings.site_description,
    site_locale: settings.site_locale,
    site_timezone: settings.site_timezone,
    uptime_rating_level: monitorData.uptimeRatingLevel,
    overall_status: monitorData.overallStatus,
    banner: buildPublicStatusBanner({
      counts: monitorData.summary,
      monitorCount: monitorData.monitors.length,
      activeIncidents,
      activeMaintenanceWindows: maintenanceWindows.active,
    }),
    summary: monitorData.summary,
    monitors: monitorData.monitors,
    active_incidents: activeIncidentSummaries,
    maintenance_windows: {
      active: activeMaintenancePreview,
      upcoming: upcomingMaintenancePreview,
    },
    resolved_incident_preview: resolvedIncidentPreview
      ? toIncidentSummary(resolvedIncidentPreview)
      : null,
    maintenance_history_preview: maintenanceHistoryPreview
      ? toMaintenancePreview(maintenanceHistoryPreview.row, maintenanceHistoryPreview.monitorIds)
      : null,
  };
}

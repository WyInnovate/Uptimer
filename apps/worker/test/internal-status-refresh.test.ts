import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/public/status-refresh', () => ({
  tryComputePublicStatusPayloadFromScheduledRuntimeUpdates: vi.fn(),
}));
vi.mock('../src/snapshots/public-status', () => ({
  toSnapshotPayload: vi.fn((value) => value),
  prepareStatusSnapshotWrite: vi.fn(),
  didApplyStatusSnapshotWrite: vi.fn(),
}));
vi.mock('../src/snapshots/public-status-read', () => ({
  readCachedStatusSnapshotPayloadAnyAge: vi.fn(),
  readStatusSnapshotPayloadAnyAge: vi.fn(),
}));

import type { Env } from '../src/env';
import worker from '../src/index';
import { tryComputePublicStatusPayloadFromScheduledRuntimeUpdates } from '../src/public/status-refresh';
import {
  didApplyStatusSnapshotWrite,
  prepareStatusSnapshotWrite,
  toSnapshotPayload,
} from '../src/snapshots/public-status';
import {
  readCachedStatusSnapshotPayloadAnyAge,
  readStatusSnapshotPayloadAnyAge,
} from '../src/snapshots/public-status-read';

function createStatusPayload(now: number) {
  return {
    generated_at: now - 60,
    site_title: 'Status Hub',
    site_description: 'Production services',
    site_locale: 'en' as const,
    site_timezone: 'UTC',
    uptime_rating_level: 4 as const,
    overall_status: 'up' as const,
    banner: {
      source: 'monitors' as const,
      status: 'operational' as const,
      title: 'All Systems Operational',
      down_ratio: null,
    },
    summary: {
      up: 1,
      down: 0,
      maintenance: 0,
      paused: 0,
      unknown: 0,
    },
    monitors: [],
    active_incidents: [],
    maintenance_windows: {
      active: [],
      upcoming: [],
    },
  };
}

describe('internal status refresh route', () => {
  let prime: ReturnType<typeof vi.fn>;
  let run: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    prime = vi.fn();
    run = vi.fn(async () => ({ meta: { changes: 1 } }));
    vi.mocked(prepareStatusSnapshotWrite).mockReturnValue({
      statement: { run } as unknown as D1PreparedStatement,
      prime,
    });
    vi.mocked(didApplyStatusSnapshotWrite).mockReturnValue(true);
  });

  it('patches and writes a status snapshot from scheduled runtime updates', async () => {
    const now = 1_776_230_340;
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
    const basePayload = createStatusPayload(now);
    const patchedPayload = { ...basePayload, generated_at: now };
    vi.mocked(readCachedStatusSnapshotPayloadAnyAge).mockReturnValue({
      data: basePayload,
      bodyJson: JSON.stringify(basePayload),
      age: 60,
    });
    vi.mocked(tryComputePublicStatusPayloadFromScheduledRuntimeUpdates).mockResolvedValue(
      patchedPayload as never,
    );
    const env = {
      DB: {} as D1Database,
      ADMIN_TOKEN: 'test-admin-token',
    } as Env;

    const res = await worker.fetch(
      new Request('http://internal/api/v1/internal/refresh/status', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-admin-token',
          'Content-Type': 'application/json; charset=utf-8',
          'X-Uptimer-Internal-Format': 'compact-v1',
          'X-Uptimer-Refresh-Source': 'scheduled',
        },
        body: JSON.stringify({
          runtime_updates: [[1, 60, now - 300, now, 'up', 'up', 55]],
        }),
      }),
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, refreshed: true });
    expect(readStatusSnapshotPayloadAnyAge).not.toHaveBeenCalled();
    expect(tryComputePublicStatusPayloadFromScheduledRuntimeUpdates).toHaveBeenCalledWith({
      db: env.DB,
      now,
      baseSnapshot: basePayload,
      updates: [
        {
          monitor_id: 1,
          interval_sec: 60,
          created_at: now - 300,
          checked_at: now,
          check_status: 'up',
          next_status: 'up',
          latency_ms: 55,
        },
      ],
    });
    expect(toSnapshotPayload).toHaveBeenCalledWith(patchedPayload);
    expect(prepareStatusSnapshotWrite).toHaveBeenCalledWith({
      db: env.DB,
      now,
      payload: patchedPayload,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(prime).toHaveBeenCalledTimes(1);
  });

  it('returns not refreshed when runtime updates are absent', async () => {
    const now = 1_776_230_340;
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
    const env = {
      DB: {} as D1Database,
      ADMIN_TOKEN: 'test-admin-token',
    } as Env;

    const res = await worker.fetch(
      new Request('http://internal/api/v1/internal/refresh/status', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-admin-token',
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({}),
      }),
      env,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, refreshed: false });
    expect(tryComputePublicStatusPayloadFromScheduledRuntimeUpdates).not.toHaveBeenCalled();
    expect(prepareStatusSnapshotWrite).not.toHaveBeenCalled();
  });
});

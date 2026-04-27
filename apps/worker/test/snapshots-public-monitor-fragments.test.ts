import { describe, expect, it } from 'vitest';

import {
  buildHomepageMonitorFragmentWrites,
  buildStatusMonitorFragmentWrites,
  HOMEPAGE_MONITOR_FRAGMENTS_KEY,
  STATUS_MONITOR_FRAGMENTS_KEY,
  toPublicMonitorFragmentKey,
} from '../src/snapshots/public-monitor-fragments';

function statusMonitor(id: number) {
  return {
    id,
    name: `Monitor ${id}`,
    type: 'http' as const,
    group_name: 'Core',
    group_sort_order: 0,
    sort_order: id,
    uptime_rating_level: 4 as const,
    status: 'up' as const,
    is_stale: false,
    last_checked_at: 1_700_000_000,
    last_latency_ms: 42,
    heartbeats: [
      {
        checked_at: 1_700_000_000,
        status: 'up' as const,
        latency_ms: 42,
      },
    ],
    uptime_30d: {
      range_start_at: 1_697_408_000,
      range_end_at: 1_700_000_000,
      total_sec: 2_592_000,
      downtime_sec: 0,
      unknown_sec: 0,
      uptime_sec: 2_592_000,
      uptime_pct: 100,
    },
    uptime_days: [
      {
        day_start_at: 1_699_920_000,
        total_sec: 86_400,
        downtime_sec: 0,
        unknown_sec: 0,
        uptime_sec: 86_400,
        uptime_pct: 100,
      },
    ],
  };
}

function statusPayload() {
  return {
    generated_at: 1_700_000_000,
    site_title: 'Uptimer',
    site_description: '',
    site_locale: 'auto' as const,
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
      up: 2,
      down: 0,
      maintenance: 0,
      paused: 0,
      unknown: 0,
    },
    monitors: [statusMonitor(1), statusMonitor(2)],
    active_incidents: [],
    maintenance_windows: {
      active: [],
      upcoming: [],
    },
  };
}

function homepageMonitor(id: number) {
  return {
    id,
    name: `Monitor ${id}`,
    type: 'http' as const,
    group_name: 'Core',
    status: 'up' as const,
    is_stale: false,
    last_checked_at: 1_700_000_000,
    heartbeat_strip: {
      checked_at: [1_700_000_000],
      status_codes: 'u',
      latency_ms: [42],
    },
    uptime_30d: {
      uptime_pct: 100,
    },
    uptime_day_strip: {
      day_start_at: [1_699_920_000],
      downtime_sec: [0],
      unknown_sec: [0],
      uptime_pct_milli: [100_000],
    },
  };
}

function homepagePayload() {
  return {
    generated_at: 1_700_000_000,
    bootstrap_mode: 'full' as const,
    monitor_count_total: 2,
    site_title: 'Uptimer',
    site_description: '',
    site_locale: 'auto' as const,
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
      up: 2,
      down: 0,
      maintenance: 0,
      paused: 0,
      unknown: 0,
    },
    monitors: [homepageMonitor(1), homepageMonitor(2)],
    active_incidents: [],
    maintenance_windows: {
      active: [],
      upcoming: [],
    },
    resolved_incident_preview: null,
    maintenance_history_preview: null,
  };
}

describe('snapshots/public-monitor-fragments', () => {
  it('serializes status monitor fragments without duplicating the status envelope', () => {
    const writes = buildStatusMonitorFragmentWrites(statusPayload(), 1_700_000_005);

    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      snapshotKey: STATUS_MONITOR_FRAGMENTS_KEY,
      fragmentKey: 'monitor:1',
      generatedAt: 1_700_000_000,
      updatedAt: 1_700_000_005,
    });
    expect(JSON.parse(writes[0]!.bodyJson)).toEqual(statusMonitor(1));
    expect(writes[0]!.bodyJson).toContain('heartbeats');
    expect(writes[0]!.bodyJson).toContain('uptime_days');
    expect(writes[0]!.bodyJson).not.toContain('site_title');
  });

  it('serializes only selected status monitor fragments', () => {
    const writes = buildStatusMonitorFragmentWrites(statusPayload(), 1_700_000_005, [2]);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.fragmentKey).toBe('monitor:2');
    expect(JSON.parse(writes[0]!.bodyJson).id).toBe(2);
  });

  it('serializes homepage monitor fragments separately from status fragments', () => {
    const writes = buildHomepageMonitorFragmentWrites(homepagePayload(), 1_700_000_005, [1]);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      snapshotKey: HOMEPAGE_MONITOR_FRAGMENTS_KEY,
      fragmentKey: 'monitor:1',
      generatedAt: 1_700_000_000,
      updatedAt: 1_700_000_005,
    });
    expect(JSON.parse(writes[0]!.bodyJson)).toEqual(homepageMonitor(1));
    expect(writes[0]!.bodyJson).toContain('heartbeat_strip');
    expect(writes[0]!.bodyJson).toContain('uptime_day_strip');
    expect(writes[0]!.bodyJson).not.toContain('bootstrap_mode');
  });

  it('validates monitor fragment keys', () => {
    expect(toPublicMonitorFragmentKey(42)).toBe('monitor:42');
    expect(() => toPublicMonitorFragmentKey(0)).toThrow('positive integer');
    expect(() => buildStatusMonitorFragmentWrites(statusPayload(), 1, [0])).toThrow(
      'positive integer',
    );
  });
});

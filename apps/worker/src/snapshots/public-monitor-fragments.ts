import type { PublicHomepageResponse } from '../schemas/public-homepage';
import type { PublicStatusResponse } from '../schemas/public-status';
import type { PublicSnapshotFragmentWrite } from './public-fragments';

export const STATUS_MONITOR_FRAGMENTS_KEY = 'status:monitors';
export const HOMEPAGE_MONITOR_FRAGMENTS_KEY = 'homepage:monitors';

const MONITOR_FRAGMENT_PREFIX = 'monitor:';

function assertMonitorId(monitorId: number): void {
  if (!Number.isInteger(monitorId) || monitorId <= 0) {
    throw new Error('public monitor fragment id must be a positive integer');
  }
}

function toSelectedMonitorIdSet(monitorIds?: Iterable<number>): Set<number> | null {
  if (!monitorIds) {
    return null;
  }

  const selected = new Set<number>();
  for (const monitorId of monitorIds) {
    assertMonitorId(monitorId);
    selected.add(monitorId);
  }
  return selected;
}

export function toPublicMonitorFragmentKey(monitorId: number): string {
  assertMonitorId(monitorId);
  return `${MONITOR_FRAGMENT_PREFIX}${monitorId}`;
}

function shouldWriteMonitorFragment(
  selectedMonitorIds: ReadonlySet<number> | null,
  monitorId: number,
): boolean {
  return selectedMonitorIds === null || selectedMonitorIds.has(monitorId);
}

function buildMonitorFragmentWrite(opts: {
  snapshotKey: string;
  fragmentKey: string;
  generatedAt: number;
  bodyJson: string;
  updatedAt: number;
}): PublicSnapshotFragmentWrite {
  return {
    snapshotKey: opts.snapshotKey,
    fragmentKey: opts.fragmentKey,
    generatedAt: opts.generatedAt,
    bodyJson: opts.bodyJson,
    updatedAt: opts.updatedAt,
  };
}

export function buildStatusMonitorFragmentWrites(
  payload: PublicStatusResponse,
  updatedAt: number,
  monitorIds?: Iterable<number>,
): PublicSnapshotFragmentWrite[] {
  const selectedMonitorIds = toSelectedMonitorIdSet(monitorIds);
  const writes: PublicSnapshotFragmentWrite[] = [];

  for (const monitor of payload.monitors) {
    if (!shouldWriteMonitorFragment(selectedMonitorIds, monitor.id)) {
      continue;
    }
    writes.push(
      buildMonitorFragmentWrite({
        snapshotKey: STATUS_MONITOR_FRAGMENTS_KEY,
        fragmentKey: toPublicMonitorFragmentKey(monitor.id),
        generatedAt: payload.generated_at,
        bodyJson: JSON.stringify(monitor),
        updatedAt,
      }),
    );
  }

  return writes;
}

export function buildHomepageMonitorFragmentWrites(
  payload: PublicHomepageResponse,
  updatedAt: number,
  monitorIds?: Iterable<number>,
): PublicSnapshotFragmentWrite[] {
  const selectedMonitorIds = toSelectedMonitorIdSet(monitorIds);
  const writes: PublicSnapshotFragmentWrite[] = [];

  for (const monitor of payload.monitors) {
    if (!shouldWriteMonitorFragment(selectedMonitorIds, monitor.id)) {
      continue;
    }
    writes.push(
      buildMonitorFragmentWrite({
        snapshotKey: HOMEPAGE_MONITOR_FRAGMENTS_KEY,
        fragmentKey: toPublicMonitorFragmentKey(monitor.id),
        generatedAt: payload.generated_at,
        bodyJson: JSON.stringify(monitor),
        updatedAt,
      }),
    );
  }

  return writes;
}

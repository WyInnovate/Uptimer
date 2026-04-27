import type { Env } from '../env';
import type { Trace } from '../observability/trace';
import type { MonitorRuntimeUpdate } from '../public/monitor-runtime';

export type InternalStatusRefreshCoreResult = {
  ok: boolean;
  refreshed: boolean;
  skip?: 'no_runtime_updates' | 'no_base_snapshot' | 'no_payload' | 'status_write_noop';
  error?: true;
  baseSnapshotSource?: 'memory_cache' | 'd1';
};

type InternalStatusRefreshCoreOptions = {
  env: Env;
  now: number;
  runtimeUpdates?: MonitorRuntimeUpdate[];
  trace?: Trace | null;
};

function toInternalStatusRefreshCoreResult(
  ok: boolean,
  refreshed: boolean,
  extra: Omit<InternalStatusRefreshCoreResult, 'ok' | 'refreshed'> = {},
): InternalStatusRefreshCoreResult {
  return { ok, refreshed, ...extra };
}

export async function runInternalStatusRefreshCore({
  env,
  now,
  runtimeUpdates,
  trace,
}: InternalStatusRefreshCoreOptions): Promise<InternalStatusRefreshCoreResult> {
  trace?.setLabel('route', 'internal/status-refresh');
  trace?.setLabel('now', now);
  trace?.setLabel('runtime_updates_count', runtimeUpdates?.length ?? 0);

  if (!runtimeUpdates || runtimeUpdates.length === 0) {
    trace?.setLabel('skip', 'no_runtime_updates');
    return toInternalStatusRefreshCoreResult(true, false, { skip: 'no_runtime_updates' });
  }

  try {
    const [statusMod, statusSnapshotMod, statusSnapshotReadMod] = await Promise.all([
      trace
        ? trace.timeAsync(
            'import_status_refresh_module',
            async () => await import('../public/status-refresh'),
          )
        : import('../public/status-refresh'),
      trace
        ? trace.timeAsync(
            'import_status_snapshot_module',
            async () => await import('../snapshots/public-status'),
          )
        : import('../snapshots/public-status'),
      trace
        ? trace.timeAsync(
            'import_status_snapshot_read_module',
            async () => await import('../snapshots/public-status-read'),
          )
        : import('../snapshots/public-status-read'),
    ]);

    const cachedBaseSnapshot = statusSnapshotReadMod.readCachedStatusSnapshotPayloadAnyAge(
      env.DB,
      now,
    );
    if (trace?.enabled && cachedBaseSnapshot) {
      trace.setLabel('status_base_snapshot', 'memory_cache');
    }
    const statusBaseSnapshot = cachedBaseSnapshot
      ? cachedBaseSnapshot
      : trace
        ? await trace.timeAsync(
            'status_refresh_read_base_snapshot',
            async () => await statusSnapshotReadMod.readStatusSnapshotPayloadAnyAge(env.DB, now),
          )
        : await statusSnapshotReadMod.readStatusSnapshotPayloadAnyAge(env.DB, now);
    const baseSnapshotSource = cachedBaseSnapshot ? 'memory_cache' : 'd1';
    if (trace?.enabled && !cachedBaseSnapshot && statusBaseSnapshot) {
      trace.setLabel('status_base_snapshot', 'd1');
    }
    if (!statusBaseSnapshot) {
      trace?.setLabel('skip', 'no_base_snapshot');
      return toInternalStatusRefreshCoreResult(true, false, {
        skip: 'no_base_snapshot',
        baseSnapshotSource,
      });
    }

    const patchedPayload = trace
      ? await trace.timeAsync(
          'status_refresh_fast_compute',
          async () =>
            await statusMod.tryComputePublicStatusPayloadFromScheduledRuntimeUpdates({
              db: env.DB,
              now,
              updates: runtimeUpdates,
              baseSnapshot: statusBaseSnapshot.data,
            }),
        )
      : await statusMod.tryComputePublicStatusPayloadFromScheduledRuntimeUpdates({
          db: env.DB,
          now,
          updates: runtimeUpdates,
          baseSnapshot: statusBaseSnapshot.data,
        });
    if (!patchedPayload) {
      trace?.setLabel('skip', 'no_payload');
      return toInternalStatusRefreshCoreResult(true, false, {
        skip: 'no_payload',
        baseSnapshotSource,
      });
    }

    const payload = trace
      ? trace.time('status_refresh_validate', () => statusSnapshotMod.toSnapshotPayload(patchedPayload))
      : statusSnapshotMod.toSnapshotPayload(patchedPayload);
    const prepared = trace
      ? trace.time('status_prepare_write', () =>
          statusSnapshotMod.prepareStatusSnapshotWrite({
            db: env.DB,
            now,
            payload,
            trace,
          }),
        )
      : statusSnapshotMod.prepareStatusSnapshotWrite({
          db: env.DB,
          now,
          payload,
        });
    const writeResult = trace
      ? await trace.timeAsync('status_refresh_write', async () => await prepared.statement.run())
      : await prepared.statement.run();
    if (!statusSnapshotMod.didApplyStatusSnapshotWrite(writeResult)) {
      trace?.setLabel('skip', 'status_write_noop');
      return toInternalStatusRefreshCoreResult(true, false, {
        skip: 'status_write_noop',
        baseSnapshotSource,
      });
    }

    prepared.prime();
    trace?.setLabel('status_refresh', 'patched');
    return toInternalStatusRefreshCoreResult(true, true, { baseSnapshotSource });
  } catch (err) {
    console.warn('internal refresh: status failed', err);
    trace?.setLabel('error', '1');
    return toInternalStatusRefreshCoreResult(false, false, { error: true });
  }
}

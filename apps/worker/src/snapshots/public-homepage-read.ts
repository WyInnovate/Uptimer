import { AppError } from '../middleware/errors';
import {
  publicHomepageRenderArtifactSchema,
  publicHomepageResponseSchema,
  type PublicHomepageRenderArtifact,
  type PublicHomepageResponse,
} from '../schemas/public-homepage';

const SNAPSHOT_KEY = 'homepage';
const SNAPSHOT_ARTIFACT_KEY = 'homepage:artifact';
const MAX_AGE_SECONDS = 60;
const MAX_STALE_SECONDS = 10 * 60;
const SPLIT_SNAPSHOT_VERSION = 3;
const LEGACY_COMBINED_SNAPSHOT_VERSION = 2;

const READ_SNAPSHOT_SQL = `
  SELECT generated_at, body_json
  FROM public_snapshots
  WHERE key = ?1
`;
const readSnapshotStatementByDb = new WeakMap<D1Database, D1PreparedStatement>();

type SnapshotRow = {
  generated_at: number;
  body_json: string;
};

type NormalizedSnapshotPayloadRow = {
  generatedAt: number;
  bodyJson: string;
};

type SnapshotJsonResult = {
  bodyJson: string;
  age: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeJsonParse(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function normalizeDirectHomepagePayload(value: unknown): PublicHomepageResponse | null {
  const directPayload = publicHomepageResponseSchema.safeParse(value);
  if (directPayload.success) {
    return directPayload.data;
  }
  if (!isRecord(value)) {
    return null;
  }

  const normalizedPayload = publicHomepageResponseSchema.safeParse({
    ...value,
    bootstrap_mode:
      value.bootstrap_mode === 'full' || value.bootstrap_mode === 'partial'
        ? value.bootstrap_mode
        : 'full',
    monitor_count_total: Array.isArray(value.monitors) ? value.monitors.length : 0,
  });
  return normalizedPayload.success ? normalizedPayload.data : null;
}

function normalizeHomepagePayload(value: unknown): PublicHomepageResponse | null {
  const artifact = publicHomepageRenderArtifactSchema.safeParse(value);
  if (artifact.success) {
    return artifact.data.snapshot;
  }
  if (!isRecord(value)) {
    return null;
  }

  const version = value.version;
  if (version === SPLIT_SNAPSHOT_VERSION || version === LEGACY_COMBINED_SNAPSHOT_VERSION) {
    return normalizeDirectHomepagePayload(value.data);
  }

  return normalizeDirectHomepagePayload(value);
}

function normalizeHomepageArtifact(value: unknown): PublicHomepageRenderArtifact | null {
  const artifact = publicHomepageRenderArtifactSchema.safeParse(value);
  if (artifact.success) {
    return artifact.data;
  }
  if (!isRecord(value)) {
    return null;
  }

  const version = value.version;
  if (version !== SPLIT_SNAPSHOT_VERSION && version !== LEGACY_COMBINED_SNAPSHOT_VERSION) {
    return null;
  }

  const legacyArtifact = publicHomepageRenderArtifactSchema.safeParse(value.render);
  return legacyArtifact.success ? legacyArtifact.data : null;
}

function normalizeHomepagePayloadBodyJson(bodyJson: string): string | null {
  const parsed = safeJsonParse(bodyJson);
  if (parsed === null) return null;

  const payload = normalizeHomepagePayload(parsed);
  return payload ? JSON.stringify(payload) : null;
}

function normalizeHomepageArtifactBodyJson(bodyJson: string): string | null {
  const parsed = safeJsonParse(bodyJson);
  if (parsed === null) return null;

  const artifact = normalizeHomepageArtifact(parsed);
  return artifact ? JSON.stringify(artifact) : null;
}

function isSameUtcDay(a: number, b: number): boolean {
  return Math.floor(a / 86_400) === Math.floor(b / 86_400);
}

async function readSnapshotRow(
  db: D1Database,
  key: string,
): Promise<SnapshotRow | null> {
  try {
    const cached = readSnapshotStatementByDb.get(db);
    const statement = cached ?? db.prepare(READ_SNAPSHOT_SQL);
    if (!cached) {
      readSnapshotStatementByDb.set(db, statement);
    }

    return await statement.bind(key).first<SnapshotRow>();
  } catch (err) {
    console.warn('homepage snapshot: read failed', err);
    return null;
  }
}

export async function readHomepageSnapshotGeneratedAt(db: D1Database): Promise<number | null> {
  const rows = await readSnapshotRowsByPriority(db);
  const validRows = rows
    .map((row) => normalizeSnapshotPayloadRow(row))
    .filter((row): row is NormalizedSnapshotPayloadRow => row !== null);
  const freshest = pickFreshestSnapshotRow(validRows);
  return freshest?.generatedAt ?? null;
}

export async function readHomepageArtifactSnapshotGeneratedAt(
  db: D1Database,
): Promise<number | null> {
  const row = await readSnapshotRow(db, SNAPSHOT_ARTIFACT_KEY);
  if (!row) return null;
  return normalizeHomepageArtifactBodyJson(row.body_json) ? row.generated_at : null;
}

function normalizeSnapshotPayloadRow(row: SnapshotRow | null): NormalizedSnapshotPayloadRow | null {
  if (!row) return null;

  const bodyJson = normalizeHomepagePayloadBodyJson(row.body_json);
  if (!bodyJson) {
    return null;
  }

  return {
    generatedAt: row.generated_at,
    bodyJson,
  };
}

function pickFreshestSnapshotRow(
  rows: readonly NormalizedSnapshotPayloadRow[],
): NormalizedSnapshotPayloadRow | null {
  if (rows.length === 0) {
    return null;
  }

  let freshest = rows[0] ?? null;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;
    if (!freshest || row.generatedAt > freshest.generatedAt) {
      freshest = row;
    }
  }

  return freshest;
}

async function readSnapshotRowsByPriority(db: D1Database): Promise<SnapshotRow[]> {
  const [artifactRow, homepageRow] = await Promise.all([
    readSnapshotRow(db, SNAPSHOT_ARTIFACT_KEY),
    readSnapshotRow(db, SNAPSHOT_KEY),
  ]);

  return [artifactRow, homepageRow].filter((row): row is SnapshotRow => row !== null);
}

function readSnapshotJsonFromRows(
  rows: readonly SnapshotRow[],
  now: number,
  maxAgeSeconds: number,
  normalizeBodyJson: (bodyJson: string) => string | null,
  warning: string,
): SnapshotJsonResult | null {
  let freshest: SnapshotJsonResult | null = null;

  for (const row of rows) {
    const age = Math.max(0, now - row.generated_at);
    if (age > maxAgeSeconds) {
      continue;
    }

    const bodyJson = normalizeBodyJson(row.body_json);
    if (!bodyJson) {
      console.warn(warning);
      continue;
    }

    if (freshest === null || row.generated_at > now - freshest.age) {
      freshest = { bodyJson, age };
    }
  }

  return freshest;
}

export async function readHomepageRefreshBaseSnapshot(
  db: D1Database,
  now: number,
): Promise<{
  generatedAt: number | null;
  bodyJson: string | null;
  seedDataSnapshot: boolean;
}> {
  const [artifactRow, homepageRow] = await Promise.all([
    readSnapshotRow(db, SNAPSHOT_ARTIFACT_KEY),
    readSnapshotRow(db, SNAPSHOT_KEY),
  ]);

  const normalizedRows = [normalizeSnapshotPayloadRow(artifactRow), normalizeSnapshotPayloadRow(homepageRow)]
    .filter((row): row is NormalizedSnapshotPayloadRow => row !== null);
  const sameDayBase = pickFreshestSnapshotRow(
    normalizedRows.filter((row) => isSameUtcDay(row.generatedAt, now)),
  );
  if (sameDayBase) {
    return {
      generatedAt: sameDayBase.generatedAt,
      bodyJson: sameDayBase.bodyJson,
      seedDataSnapshot: false,
    };
  }

  const freshestBase = pickFreshestSnapshotRow(normalizedRows);
  if (freshestBase) {
    return {
      generatedAt: freshestBase.generatedAt,
      bodyJson: freshestBase.bodyJson,
      seedDataSnapshot: true,
    };
  }

  if (!artifactRow && !homepageRow) {
    return {
      generatedAt: null,
      bodyJson: null,
      seedDataSnapshot: true,
    };
  }

  console.warn('homepage snapshot: invalid refresh payload');

  return {
    generatedAt: null,
    bodyJson: null,
    seedDataSnapshot: true,
  };
}

export function applyHomepageCacheHeaders(res: Response, ageSeconds: number): void {
  const remaining = Math.max(0, MAX_AGE_SECONDS - ageSeconds);
  const maxAge = Math.min(30, remaining);
  const stale = Math.max(0, remaining - maxAge);

  res.headers.set(
    'Cache-Control',
    `public, max-age=${maxAge}, stale-while-revalidate=${stale}, stale-if-error=${stale}`,
  );
}

export async function readHomepageSnapshotJsonAnyAge(
  db: D1Database,
  now: number,
  maxStaleSeconds = MAX_STALE_SECONDS,
): Promise<{ bodyJson: string; age: number } | null> {
  const rows = await readSnapshotRowsByPriority(db);
  return readSnapshotJsonFromRows(
    rows,
    now,
    maxStaleSeconds,
    normalizeHomepagePayloadBodyJson,
    'homepage snapshot: invalid payload',
  );
}

export async function readHomepageSnapshotJson(
  db: D1Database,
  now: number,
): Promise<{ bodyJson: string; age: number } | null> {
  return await readHomepageSnapshotJsonAnyAge(db, now, MAX_AGE_SECONDS);
}

export async function readHomepageSnapshotArtifactJson(
  db: D1Database,
  now: number,
): Promise<{ bodyJson: string; age: number } | null> {
  const rows = await readSnapshotRowsByPriority(db);
  return readSnapshotJsonFromRows(
    rows,
    now,
    MAX_AGE_SECONDS,
    normalizeHomepageArtifactBodyJson,
    'homepage snapshot: invalid artifact payload',
  );
}

export async function readStaleHomepageSnapshotArtifactJson(
  db: D1Database,
  now: number,
): Promise<{ bodyJson: string; age: number } | null> {
  const rows = await readSnapshotRowsByPriority(db);
  return readSnapshotJsonFromRows(
    rows,
    now,
    MAX_STALE_SECONDS,
    normalizeHomepageArtifactBodyJson,
    'homepage snapshot: invalid stale artifact payload',
  );
}

export function assertHomepageArtifactAvailable(): never {
  throw new AppError(503, 'UNAVAILABLE', 'Homepage artifact unavailable');
}

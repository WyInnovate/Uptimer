export async function acquireLease(
  db: D1Database,
  name: string,
  now: number,
  leaseSeconds: number,
): Promise<boolean> {
  const expiresAt = now + leaseSeconds;

  const r = await db
    .prepare(
      `
      INSERT INTO locks (name, expires_at)
      VALUES (?1, ?2)
      ON CONFLICT(name) DO UPDATE SET expires_at = excluded.expires_at
      WHERE locks.expires_at <= ?3
    `,
    )
    .bind(name, expiresAt, now)
    .run();

  return (r.meta.changes ?? 0) > 0;
}

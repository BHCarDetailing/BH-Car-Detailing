export const uuid = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

export async function one<T = Record<string, unknown>>(
  db: D1Database, sql: string, ...binds: unknown[]
): Promise<T | null> {
  return ((await db.prepare(sql).bind(...binds).first<T>()) ?? null);
}

export async function all<T = Record<string, unknown>>(
  db: D1Database, sql: string, ...binds: unknown[]
): Promise<T[]> {
  const r = await db.prepare(sql).bind(...binds).all<T>();
  return r.results;
}

export async function run(db: D1Database, sql: string, ...binds: unknown[]) {
  return db.prepare(sql).bind(...binds).run();
}

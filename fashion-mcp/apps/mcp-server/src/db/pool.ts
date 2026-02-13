import pg from "pg";
import { getConfig } from "../config.js";

let cachedPool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!cachedPool) {
    const config = getConfig();
    cachedPool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      // Prefer TLS for production RDS. When not set, defaults to plain TCP.
      ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    });
  }
  return cachedPool;
}

export async function closePool(): Promise<void> {
  if (!cachedPool) return;
  await cachedPool.end();
  cachedPool = null;
}

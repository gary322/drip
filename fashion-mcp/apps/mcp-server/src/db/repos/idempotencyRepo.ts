import { createHash } from "node:crypto";
import { getPool } from "../pool.js";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency_key_conflict");
    this.name = "IdempotencyConflictError";
  }
}

function hashRequest(input: unknown): string {
  const serialized = JSON.stringify(input ?? {});
  return createHash("sha256").update(serialized).digest("hex");
}

export async function getIdempotentResponse(input: {
  userId: string;
  operation: string;
  idempotencyKey: string;
  payload: unknown;
}): Promise<{ hit: boolean; response?: Record<string, unknown> }> {
  const pool = getPool();
  const requestHash = hashRequest(input.payload);
  const compositeKey = `${input.userId}:${input.operation}:${input.idempotencyKey}`;
  const { rows } = await pool.query(
    `SELECT request_hash, response
       FROM idempotency_keys
      WHERE key=$1 AND user_id=$2 AND operation=$3 AND expires_at > now()`,
    [compositeKey, input.userId, input.operation]
  );
  const row = rows[0];
  if (!row) {
    return { hit: false };
  }
  if (row.request_hash !== requestHash) {
    throw new IdempotencyConflictError();
  }
  return { hit: true, response: row.response as Record<string, unknown> };
}

export async function saveIdempotentResponse(input: {
  userId: string;
  operation: string;
  idempotencyKey: string;
  payload: unknown;
  response: Record<string, unknown>;
  ttlSeconds?: number;
}): Promise<void> {
  const pool = getPool();
  const requestHash = hashRequest(input.payload);
  const compositeKey = `${input.userId}:${input.operation}:${input.idempotencyKey}`;
  const ttl = input.ttlSeconds ?? 3600;
  await pool.query(
    `INSERT INTO idempotency_keys(key, user_id, operation, request_hash, response, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)
     ON CONFLICT (key) DO UPDATE
       SET request_hash=EXCLUDED.request_hash,
           response=EXCLUDED.response,
           expires_at=EXCLUDED.expires_at`,
    [compositeKey, input.userId, input.operation, requestHash, input.response, String(ttl)]
  );
}

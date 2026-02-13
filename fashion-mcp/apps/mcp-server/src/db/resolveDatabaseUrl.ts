import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickFirstNonEmpty(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (isNonEmptyString(v)) return v.trim();
  }
  return null;
}

function encodeUserInfo(value: string): string {
  return encodeURIComponent(value).replaceAll("%20", "+");
}

/**
 * Ensures `process.env.DATABASE_URL` is set.
 *
 * Production deployments on AWS should prefer passing a Secrets Manager secret ARN via
 * `DATABASE_SECRET_ARN` (or `DB_SECRET_ARN`) instead of embedding credentials directly in env vars.
 *
 * Supported secret formats:
 * - RDS managed master secret JSON (contains `username`, `password`, `host`, `port`, `dbname`)
 * - Generic JSON with at least `password` + (`username`/`user`) and (`host`) (or provide host via env)
 */
export async function ensureDatabaseUrl(): Promise<void> {
  if (isNonEmptyString(process.env.DATABASE_URL)) return;

  const secretArn = pickFirstNonEmpty(process.env.DATABASE_SECRET_ARN, process.env.DB_SECRET_ARN);
  if (!secretArn) {
    throw new Error("DATABASE_URL missing and DATABASE_SECRET_ARN/DB_SECRET_ARN not set");
  }

  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const secretString = res.SecretString;
  if (!isNonEmptyString(secretString)) {
    throw new Error("database_secret_missing_string");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(secretString) as Record<string, unknown>;
  } catch {
    throw new Error("database_secret_not_json");
  }

  // Prefer values from the secret (RDS-managed secrets include these).
  const username = pickFirstNonEmpty(
    parsed.username,
    parsed.user,
    process.env.DATABASE_USER,
    process.env.DB_USER,
    "fashion"
  ) ?? "fashion";
  const password = pickFirstNonEmpty(parsed.password, process.env.DATABASE_PASSWORD, process.env.DB_PASSWORD);
  if (!password) {
    throw new Error("database_secret_missing_password");
  }

  const host = pickFirstNonEmpty(
    parsed.host,
    process.env.DATABASE_HOST,
    process.env.DB_HOST,
    "127.0.0.1"
  ) ?? "127.0.0.1";
  const port = pickFirstNonEmpty(
    parsed.port,
    process.env.DATABASE_PORT,
    process.env.DB_PORT,
    "5432"
  ) ?? "5432";
  const dbname = pickFirstNonEmpty(
    parsed.dbname,
    process.env.DATABASE_NAME,
    process.env.DB_NAME,
    "fashion"
  ) ?? "fashion";

  process.env.DATABASE_URL = `postgres://${encodeUserInfo(username)}:${encodeUserInfo(password)}@${host}:${port}/${encodeURIComponent(dbname)}`;
}


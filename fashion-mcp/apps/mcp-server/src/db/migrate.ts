import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { closePool, getPool } from "./pool.js";
import { ensureDatabaseUrl } from "./resolveDatabaseUrl.js";

async function main() {
  await ensureDatabaseUrl();
  const pool = getPool();
  const dir = join(process.cwd(), "src", "db", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    console.log(`Applying migration: ${f}`);
    await pool.query(sql);
  }

  await closePool();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

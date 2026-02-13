import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function readSinceRowId(stateDir: string): Promise<number | undefined> {
  try {
    const raw = await readFile(join(stateDir, "since_rowid.txt"), "utf8");
    const n = Number(raw.trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeSinceRowId(stateDir: string, rowId: number): Promise<void> {
  if (!Number.isFinite(rowId) || rowId <= 0) return;
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, "since_rowid.txt"), String(Math.floor(rowId)), { mode: 0o600 });
}


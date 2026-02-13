import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export async function readFileAsBase64(path: string): Promise<string> {
  const buf = await readFile(path);
  return buf.toString("base64");
}

export async function withTempFile(
  input: { prefix: string; extension?: string; buffer: Buffer },
  fn: (absolutePath: string) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), `${input.prefix.replace(/[^a-zA-Z0-9_-]/g, "")}-`));
  try {
    await mkdir(dir, { recursive: true });
    const ext = (input.extension ?? "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "bin";
    const file = join(dir, `${randomUUID()}.${ext}`);
    await writeFile(file, input.buffer, { mode: 0o600 });
    await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function guessExtensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = String(mimeType ?? "").toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  return "jpg";
}


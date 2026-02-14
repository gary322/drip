import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig } from "../config.js";
import { detectImageExtension } from "../tryon/imageFormat.js";

export type AssetKind = "media" | "generated";

export type StoredAsset = {
  kind: AssetKind;
  fileName: string;
  mimeType: string;
  bytes: number;
  // Stable internal reference. For local provider this is the public URL.
  storageUrl: string;
  // Publicly retrievable URL (signed if needed).
  publicUrl: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isS3Url(value: string): boolean {
  return /^s3:\/\//i.test(value);
}

function parseS3Url(value: string): { bucket: string; key: string } | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "s3:") return null;
    const bucket = u.hostname;
    const key = u.pathname.replace(/^\//, "");
    if (!bucket || !key) return null;
    return { bucket, key };
  } catch {
    return null;
  }
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function resolveLocalDir(kind: AssetKind): string {
  const cfg = getConfig();
  if (kind === "generated") return resolve(process.cwd(), cfg.TRYON_OUTPUT_DIR);
  return resolve(process.cwd(), cfg.MEDIA_DIR);
}

function resolveLocalUrl(kind: AssetKind, fileName: string): string {
  const cfg = getConfig();
  const base = cfg.PUBLIC_BASE_URL.replace(/\/$/, "");
  const prefix = kind === "generated" ? "generated" : "media";
  return `${base}/${prefix}/${encodeURIComponent(fileName)}`;
}

function resolveS3Key(kind: AssetKind, fileName: string): string {
  const cfg = getConfig();
  const prefix = kind === "generated" ? cfg.ASSET_S3_GENERATED_PREFIX : cfg.ASSET_S3_MEDIA_PREFIX;
  const cleanPrefix = String(prefix ?? "").replace(/^\//, "").replace(/\/$/, "");
  const cleanFile = safePathPart(fileName);
  return cleanPrefix ? `${cleanPrefix}/${cleanFile}` : cleanFile;
}

let cachedS3: S3Client | null = null;
function getS3Client(): S3Client {
  if (!cachedS3) {
    cachedS3 = new S3Client({});
  }
  return cachedS3;
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  const readable = stream instanceof Readable ? stream : Readable.from(stream);
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] ? String(match[1]).trim() : "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  try {
    const buffer = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

export async function fetchAssetBuffer(input: { url: string; timeoutMs: number }): Promise<{ buffer: Buffer; mimeType: string }> {
  const url = input.url;
  if (!isNonEmptyString(url)) {
    throw new Error("asset_url_missing");
  }

  if (url.startsWith("data:")) {
    const decoded = decodeDataUrl(url);
    if (!decoded) throw new Error("asset_data_url_invalid");
    return decoded;
  }

  if (isS3Url(url)) {
    const parsed = parseS3Url(url);
    if (!parsed) throw new Error("asset_s3_url_invalid");
    const client = getS3Client();
    const res = await client.send(new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
    const buffer = await streamToBuffer(res.Body);
    const mimeType = res.ContentType ? String(res.ContentType) : "application/octet-stream";
    return { buffer, mimeType };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`asset_fetch_failed:${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
    return { buffer, mimeType };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolvePublicAssetUrl(input: { url: string; expiresInSeconds?: number }): Promise<string> {
  const url = input.url;
  if (!isNonEmptyString(url)) return url;
  if (!isS3Url(url)) return url;

  const parsed = parseS3Url(url);
  if (!parsed) return url;
  const cfg = getConfig();
  const bucket = parsed.bucket;
  const key = parsed.key;

  const ttl = Math.max(60, Math.min(7 * 24 * 3600, Number(input.expiresInSeconds ?? cfg.ASSET_S3_PRESIGN_TTL_SECONDS)));
  const client = getS3Client();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttl });
}

function detectImageMimeTypeFromExt(ext: "jpg" | "png" | "webp"): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpg":
    default:
      return "image/jpeg";
  }
}

export async function storeImageAsset(input: {
  kind: AssetKind;
  buffer: Buffer;
  mimeType?: string;
  // For generated outputs we prefer stable names (job id).
  fileName?: string;
  // Used only when fileName is not provided.
  prefix?: string;
}): Promise<StoredAsset> {
  const cfg = getConfig();
  const ext = detectImageExtension(input.buffer);
  const mimeType =
    input.mimeType && input.mimeType.toLowerCase().startsWith("image/")
      ? input.mimeType
      : detectImageMimeTypeFromExt(ext);

  const fileName =
    input.fileName && input.fileName.trim().length > 0
      ? safePathPart(input.fileName)
      : `${safePathPart(input.prefix ?? input.kind)}_${randomUUID()}.${ext}`;

  if (cfg.ASSET_STORE_PROVIDER === "s3") {
    if (!cfg.ASSET_S3_BUCKET) {
      throw new Error("asset_s3_bucket_not_configured");
    }

    const key = resolveS3Key(input.kind, fileName);
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.ASSET_S3_BUCKET,
        Key: key,
        Body: input.buffer,
        ContentType: mimeType,
        // Default SSE-S3; production can move to SSE-KMS.
        ServerSideEncryption: "AES256",
      })
    );

    const storageUrl = `s3://${cfg.ASSET_S3_BUCKET}/${key}`;
    const publicUrl = await resolvePublicAssetUrl({ url: storageUrl });

    return {
      kind: input.kind,
      fileName,
      bytes: input.buffer.length,
      mimeType,
      storageUrl,
      publicUrl,
    };
  }

  const dir = resolveLocalDir(input.kind);
  await mkdir(dir, { recursive: true });
  const absolutePath = join(dir, fileName);
  await writeFile(absolutePath, input.buffer, { mode: 0o600 });

  const url = resolveLocalUrl(input.kind, fileName);
  return {
    kind: input.kind,
    fileName,
    bytes: input.buffer.length,
    mimeType,
    storageUrl: url,
    publicUrl: url,
  };
}


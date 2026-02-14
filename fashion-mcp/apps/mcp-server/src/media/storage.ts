import { getConfig } from "../config.js";
import { detectImageExtension } from "../tryon/imageFormat.js";
import { storeImageAsset } from "./assetStore.js";

export type StoredMedia = {
  mediaId: string;
  fileName: string;
  storageUrl: string;
  publicUrl: string;
  mimeType: string;
  bytes: number;
};

export function isSupportedImageMimeType(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === "image/jpeg" || normalized === "image/png" || normalized === "image/webp";
}

function normalizeMimeType(input: { buffer: Buffer; mimeType?: string }): string {
  if (input.mimeType && isSupportedImageMimeType(input.mimeType)) return input.mimeType;
  const ext = detectImageExtension(input.buffer);
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

/**
 * Stores an inbound image attachment and returns a stable internal `storageUrl` plus a public URL.
 *
 * - local provider: storageUrl is an http(s) URL served via `/media/*`
 * - s3 provider: storageUrl is `s3://bucket/key` and publicUrl is a presigned GET URL
 */
export async function storeInboundImage(input: {
  buffer: Buffer;
  mimeType?: string;
  prefix?: string;
}): Promise<StoredMedia> {
  const cfg = getConfig();
  if (input.buffer.length > cfg.MEDIA_MAX_BYTES) {
    throw new Error("media_too_large");
  }

  const mimeType = normalizeMimeType(input);
  const stored = await storeImageAsset({
    kind: "media",
    buffer: input.buffer,
    mimeType,
    prefix: input.prefix ?? "media",
  });

  return {
    mediaId: stored.fileName,
    fileName: stored.fileName,
    storageUrl: stored.storageUrl,
    publicUrl: stored.publicUrl,
    mimeType: stored.mimeType,
    bytes: stored.bytes,
  };
}


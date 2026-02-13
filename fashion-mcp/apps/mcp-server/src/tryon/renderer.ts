import { Jimp } from "jimp";
import { getConfig } from "../config.js";
import { renderTryonWithGoogleVertex } from "./googleVirtualTryon.js";
import { fetchAssetBuffer } from "../media/assetStore.js";

export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const fetched = await fetchAssetBuffer({ url, timeoutMs: 15_000 });
  return fetched.buffer;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export async function renderTryonComposite(input: {
  userImageBuffer: Buffer;
  garmentImageBuffer: Buffer;
}): Promise<Buffer> {
  const user = await Jimp.read(input.userImageBuffer);
  const garment = await Jimp.read(input.garmentImageBuffer);

  const targetWidth = clamp(Math.round(user.bitmap.width * 0.55), 80, user.bitmap.width);
  const targetHeight = clamp(Math.round(user.bitmap.height * 0.45), 80, user.bitmap.height);
  garment.contain({ w: targetWidth, h: targetHeight });
  garment.opacity(0.9);

  const x = Math.round((user.bitmap.width - garment.bitmap.width) / 2);
  const y = Math.round(user.bitmap.height * 0.26);

  user.composite(garment, x, y);
  return user.getBuffer("image/jpeg");
}

export async function renderTryonImage(input: {
  userImageBuffer: Buffer;
  garmentImageBuffer: Buffer;
}): Promise<Buffer> {
  const cfg = getConfig();
  if (cfg.TRYON_PROVIDER !== "google_vertex") {
    if (cfg.TRYON_PROVIDER_STRICT) {
      throw new Error("tryon_provider_not_google_vertex");
    }
    return renderTryonComposite(input);
  }

  // IMPORTANT: Do not silently fall back to the local compositor.
  // If Vertex fails, we must fail the job to avoid returning incorrect "try-on" images.
  return renderTryonWithGoogleVertex(input);
}

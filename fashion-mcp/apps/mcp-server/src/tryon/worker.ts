import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import {
  claimNextTryonJob,
  markTryonJobCompleted,
  markTryonJobFailed,
  markTryonJobNotified,
  type TryonJobRow,
} from "../db/repos/tryonRepo.js";
import { enqueueOutboundChannelMessage } from "../db/repos/channelRepo.js";
import { getPhotoSetImages } from "../db/repos/profileRepo.js";
import { getProductById } from "../db/repos/catalogRepo.js";
import { findOutfitPrimaryItemId } from "../db/repos/planningRepo.js";
import { writeAuditEvent } from "../db/repos/auditRepo.js";
import { fetchImageBuffer, renderTryonImage } from "./renderer.js";
import { detectImageExtension } from "./imageFormat.js";
import { resolvePublicAssetUrl, storeImageAsset } from "../media/assetStore.js";

type WorkerControl = {
  stop: () => void;
};

function isChannel(value: unknown): value is "chatgpt" | "imessage" | "whatsapp" | "telegram" {
  return value === "chatgpt" || value === "imessage" || value === "whatsapp" || value === "telegram";
}

async function maybeNotifyChannel(job: TryonJobRow, parts: Array<any>): Promise<void> {
  if (!job.requested_channel || !isChannel(job.requested_channel)) return;
  if (job.result_notified_at) return;
  if (!job.requested_channel_user_id || !job.requested_channel_conversation_id) return;

  const outbound = {
    messageId: randomUUID(),
    correlationId: job.id,
    channel: job.requested_channel,
    channelConversationId: job.requested_channel_conversation_id,
    recipientId: job.requested_channel_user_id,
    parts,
    idempotencyKey: `tryon-result-${job.id}`,
    metadata: {
      tryonJobId: job.id,
      requestedMessageId: job.requested_message_id,
    },
  };

  await enqueueOutboundChannelMessage({
    channel: job.requested_channel,
    channelUserId: job.requested_channel_user_id,
    channelConversationId: job.requested_channel_conversation_id,
    userId: job.user_id,
    correlationId: job.id,
    idempotencyKey: outbound.idempotencyKey,
    payload: outbound as unknown as Record<string, unknown>,
  });

  await markTryonJobNotified({ userId: job.user_id, jobId: job.id });
  await writeAuditEvent({
    actorUserId: job.user_id,
    eventType: "tryon.job.notified",
    entityType: "tryon_job",
    entityId: job.id,
    payload: { channel: job.requested_channel },
  });
}

function resolveUserPhotoUrl(rows: Array<{
  storage_url: string | null;
  file_id: string;
  validation_status: "pending" | "approved" | "rejected";
  is_primary: boolean;
}>): string | null {
  const supported = /^(https?:\/\/|data:image\/|s3:\/\/)/i;
  const cfg = getConfig();

  const approvedRows = rows
    .filter((row) => row.validation_status === "approved")
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));

  const candidates = cfg.TRYON_REQUIRE_FULL_BODY_PHOTOS ? approvedRows : approvedRows.concat(rows);

  for (const row of candidates) {
    if (row.storage_url && supported.test(row.storage_url)) {
      return row.storage_url;
    }
    if (supported.test(row.file_id)) {
      return row.file_id;
    }
  }
  return null;
}

async function resolveGarmentUrl(job: TryonJobRow): Promise<string | null> {
  const direct = await getProductById(job.target_id);
  if (direct?.image_url) return direct.image_url;

  if (job.mode === "outfit") {
    const itemId = await findOutfitPrimaryItemId({
      userId: job.user_id,
      outfitId: job.target_id,
    });
    if (!itemId) return null;
    const item = await getProductById(itemId);
    return item?.image_url ?? null;
  }
  return null;
}

async function processJob(job: TryonJobRow, outputDir: string): Promise<void> {
  try {
    const photos = await getPhotoSetImages({
      userId: job.user_id,
      photoSetId: job.photo_set_id,
    });
    const userPhotoUrl = resolveUserPhotoUrl(photos);
    if (!userPhotoUrl) {
      throw new Error("no_user_photo_url_available");
    }

    const garmentUrl = await resolveGarmentUrl(job);
    if (!garmentUrl) {
      throw new Error("no_garment_image_available");
    }

    const [userImageBuffer, garmentImageBuffer] = await Promise.all([
      fetchImageBuffer(userPhotoUrl),
      fetchImageBuffer(garmentUrl),
    ]);
    const rendered = await renderTryonImage({ userImageBuffer, garmentImageBuffer });
    const extension = detectImageExtension(rendered);
    const fileName = `${job.id}.${extension}`;
    const stored = await storeImageAsset({
      kind: "generated",
      buffer: rendered,
      fileName,
      mimeType: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg",
    });
    const resultUrl = stored.storageUrl;
    await markTryonJobCompleted({
      userId: job.user_id,
      jobId: job.id,
      resultUrls: [resultUrl],
    });
    await writeAuditEvent({
      actorUserId: job.user_id,
      eventType: "tryon.job.completed",
      entityType: "tryon_job",
      entityId: job.id,
      payload: { resultUrl: stored.storageUrl },
    });

    const publicUrl = await resolvePublicAssetUrl({ url: stored.storageUrl });
    await maybeNotifyChannel(job, [
      { type: "text", text: "Your try-on is ready." },
      { type: "image", imageUrl: publicUrl },
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markTryonJobFailed({
      userId: job.user_id,
      jobId: job.id,
      errorMessage: message,
    });
    await writeAuditEvent({
      actorUserId: job.user_id,
      eventType: "tryon.job.failed",
      entityType: "tryon_job",
      entityId: job.id,
      payload: { error: message },
    });

    await maybeNotifyChannel(job, [
      { type: "text", text: `Try-on failed: ${message}` },
    ]);
  }
}

export async function runTryonWorkerOnce(outputDirOverride?: string): Promise<boolean> {
  const cfg = getConfig();
  const outputDir = outputDirOverride ?? resolve(process.cwd(), cfg.TRYON_OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });
  const job = await claimNextTryonJob();
  if (!job) return false;
  await processJob(job, outputDir);
  return true;
}

export async function startTryonWorker(): Promise<WorkerControl> {
  const cfg = getConfig();
  if (!cfg.TRYON_WORKER_ENABLED) {
    return { stop: () => {} };
  }

  const outputDir = resolve(process.cwd(), cfg.TRYON_OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });

  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      let loops = 0;
      while (!stopped && loops < 5) {
        const processed = await runTryonWorkerOnce(outputDir);
        if (!processed) break;
        loops += 1;
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, cfg.TRYON_POLL_INTERVAL_MS);
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

import type {
  TryonJobStatusInput,
  TryonRenderItemInput,
  TryonRenderOutfitInput,
  ChannelType,
} from "@fashion/shared";
import {
  ensureUser,
  hasActiveConsent,
  photoSetExists,
  photoSetHasApprovedPrimaryPhoto,
  getLatestApprovedPhotoSetId,
} from "../db/repos/profileRepo.js";
import { createTryonJob, getTryonJob } from "../db/repos/tryonRepo.js";
import { writeAuditEvent } from "../db/repos/auditRepo.js";
import { getConfig } from "../config.js";
import type { ToolLikeResponse } from "./profile.js";
import { resolvePublicAssetUrl } from "../media/assetStore.js";

export type TryonChannelContext = {
  channel: ChannelType;
  channelUserId: string;
  channelConversationId: string;
  requestMessageId: string;
};

async function resolvePhotoSetId(userId: string, photoSetId: string): Promise<string | null> {
  if (photoSetId !== "latest") return photoSetId;
  return getLatestApprovedPhotoSetId({ userId });
}

export async function renderItemOnUserDomain(
  userId: string,
  input: TryonRenderItemInput,
  channelContext?: TryonChannelContext
): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  const consent = await hasActiveConsent(userId, "tryon_photos");
  if (!consent) {
    return {
      content: [{ type: "text", text: "Photo consent is required for try-on." }],
      structuredContent: { ok: false, reason: "consent_required" },
    };
  }

  const resolvedPhotoSetId = await resolvePhotoSetId(userId, input.photoSetId);
  if (!resolvedPhotoSetId) {
    return {
      content: [{ type: "text", text: "No eligible photo set found. Upload a full-body photo first." }],
      structuredContent: { ok: false, reason: "photo_set_not_found" },
    };
  }

  const exists = await photoSetExists({ userId, photoSetId: resolvedPhotoSetId });
  if (!exists) {
    return {
      content: [{ type: "text", text: "Photo set not found." }],
      structuredContent: { ok: false, reason: "photo_set_not_found" },
    };
  }

  const cfg = getConfig();
  if (cfg.TRYON_REQUIRE_FULL_BODY_PHOTOS) {
    const hasApprovedPrimary = await photoSetHasApprovedPrimaryPhoto({
      userId,
      photoSetId: resolvedPhotoSetId,
    });
    if (!hasApprovedPrimary) {
      return {
        content: [
          {
            type: "text",
            text: "Please upload a full head-to-toe front-facing photo first. Try-on only works with an approved full-body primary photo.",
          },
        ],
        structuredContent: {
          ok: false,
          reason: "full_body_photo_required",
          requirement: "full_head_to_toe_front_facing",
        },
      };
    }
  }

  const job = await createTryonJob({
    userId,
    photoSetId: resolvedPhotoSetId,
    mode: "item",
    targetId: input.itemId,
    requestedChannel: channelContext?.channel,
    requestedChannelUserId: channelContext?.channelUserId,
    requestedChannelConversationId: channelContext?.channelConversationId,
    requestedMessageId: channelContext?.requestMessageId,
  });
  await writeAuditEvent({
    actorUserId: userId,
    eventType: "tryon.item.requested",
    entityType: "tryon_job",
    entityId: job.id,
    payload: { itemId: input.itemId, photoSetId: resolvedPhotoSetId },
  });

  return {
    content: [{ type: "text", text: "Try-on job queued." }],
    structuredContent: { ok: true, jobId: job.id, status: "queued" },
  };
}

export async function renderOutfitOnUserDomain(
  userId: string,
  input: TryonRenderOutfitInput,
  channelContext?: TryonChannelContext
): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  const consent = await hasActiveConsent(userId, "tryon_photos");
  if (!consent) {
    return {
      content: [{ type: "text", text: "Photo consent is required for try-on." }],
      structuredContent: { ok: false, reason: "consent_required" },
    };
  }

  const resolvedPhotoSetId = await resolvePhotoSetId(userId, input.photoSetId);
  if (!resolvedPhotoSetId) {
    return {
      content: [{ type: "text", text: "No eligible photo set found. Upload a full-body photo first." }],
      structuredContent: { ok: false, reason: "photo_set_not_found" },
    };
  }

  const exists = await photoSetExists({ userId, photoSetId: resolvedPhotoSetId });
  if (!exists) {
    return {
      content: [{ type: "text", text: "Photo set not found." }],
      structuredContent: { ok: false, reason: "photo_set_not_found" },
    };
  }

  const cfg = getConfig();
  if (cfg.TRYON_REQUIRE_FULL_BODY_PHOTOS) {
    const hasApprovedPrimary = await photoSetHasApprovedPrimaryPhoto({
      userId,
      photoSetId: resolvedPhotoSetId,
    });
    if (!hasApprovedPrimary) {
      return {
        content: [
          {
            type: "text",
            text: "Please upload a full head-to-toe front-facing photo first. Try-on only works with an approved full-body primary photo.",
          },
        ],
        structuredContent: {
          ok: false,
          reason: "full_body_photo_required",
          requirement: "full_head_to_toe_front_facing",
        },
      };
    }
  }

  const job = await createTryonJob({
    userId,
    photoSetId: resolvedPhotoSetId,
    mode: "outfit",
    targetId: input.outfitId,
    requestedChannel: channelContext?.channel,
    requestedChannelUserId: channelContext?.channelUserId,
    requestedChannelConversationId: channelContext?.channelConversationId,
    requestedMessageId: channelContext?.requestMessageId,
  });
  await writeAuditEvent({
    actorUserId: userId,
    eventType: "tryon.outfit.requested",
    entityType: "tryon_job",
    entityId: job.id,
    payload: { outfitId: input.outfitId, photoSetId: resolvedPhotoSetId },
  });

  return {
    content: [{ type: "text", text: "Try-on outfit job queued." }],
    structuredContent: { ok: true, jobId: job.id, status: "queued" },
  };
}

export async function getJobStatusDomain(userId: string, input: TryonJobStatusInput): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  const job = await getTryonJob({ userId, jobId: input.jobId });
  if (!job) {
    return {
      content: [{ type: "text", text: "Try-on job not found." }],
      structuredContent: { found: false },
    };
  }

  const resultUrls = Array.isArray(job.result_urls)
    ? await Promise.all(job.result_urls.map((u) => resolvePublicAssetUrl({ url: u })))
    : [];

  return {
    content: [],
    structuredContent: {
      found: true,
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      targetId: job.target_id,
      resultUrls,
      error: job.error_message,
    },
  };
}

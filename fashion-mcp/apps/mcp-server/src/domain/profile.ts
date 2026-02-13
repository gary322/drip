import {
  type BudgetGoals,
  type DeletePhotosInput,
  type IngestPhotosInput,
  type UpsertSizesInput,
} from "@fashion/shared";
import {
  createPhotoSet,
  deletePhotoSet,
  ensureUser,
  getProfile,
  grantConsent,
  setPhotoValidationResults,
  upsertBudgetAndGoals,
  upsertDefaultAddress,
  upsertSizes,
  type PhotoValidationUpdate,
} from "../db/repos/profileRepo.js";
import { writeAuditEvent } from "../db/repos/auditRepo.js";
import { getConfig } from "../config.js";
import { validateFullBodyPhotoUrl } from "../photos/fullBody.js";

export type ToolTextContent = { type: "text"; text: string };
export type ToolLikeResponse = {
  content: ToolTextContent[];
  structuredContent: Record<string, unknown>;
};

function humanGuidanceForFullBodyReason(reason: string): string | null {
  switch (reason) {
    case "not_head_to_toe_likely":
      return "Include your full head-to-toe body in frame (no cropping).";
    case "feet_missing":
      return "Make sure your feet (shoes) are fully visible in the photo.";
    case "head_missing":
      return "Make sure your full head is visible in the photo.";
    case "not_front_facing":
      return "Stand facing the camera (front-facing).";
    case "too_blurry":
      return "Use a sharper photo (avoid motion blur).";
    case "too_dark":
      return "Use brighter lighting (avoid strong shadows).";
    case "multiple_people_detected":
      return "Upload a photo with only you in frame.";
    case "no_person_detected":
      return "Upload a clear photo where your whole body is visible.";
    case "image_too_small":
      return "Upload a higher-resolution photo.";
    default:
      return null;
  }
}

export async function getProfileDomain(userId: string): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  const profile = await getProfile(userId);
  return {
    content: [],
    structuredContent: {
      type: "profile",
      monthlyBudget: (profile?.monthly_budget_cents ?? 0) / 100,
      currency: profile?.currency ?? "USD",
      goals: profile?.goals ?? [],
      styleTags: profile?.style_tags ?? [],
      sizes: profile?.sizes ?? {},
      defaultAddress: profile?.default_address ?? null,
    },
  };
}

export async function upsertBudgetAndGoalsDomain(
  userId: string,
  input: BudgetGoals
): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  await upsertBudgetAndGoals({
    userId,
    monthlyBudget: input.monthlyBudget,
    goals: input.goals,
    styleTags: input.styleTags,
  });
  await writeAuditEvent({
    actorUserId: userId,
    eventType: "profile.budget_goals.updated",
    entityType: "profile",
    entityId: userId,
    payload: { goals: input.goals, styleTags: input.styleTags },
  });
  return {
    content: [{ type: "text", text: "Saved your budget and goals." }],
    structuredContent: { ok: true },
  };
}

export async function upsertSizesDomain(
  userId: string,
  input: UpsertSizesInput
): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  await upsertSizes({ userId, sizes: input.sizes });
  await writeAuditEvent({
    actorUserId: userId,
    eventType: "profile.sizes.updated",
    entityType: "profile",
    entityId: userId,
    payload: { keys: Object.keys(input.sizes) },
  });
  return {
    content: [{ type: "text", text: "Saved your sizes." }],
    structuredContent: { ok: true },
  };
}

export async function ingestPhotosDomain(
  userId: string,
  input: IngestPhotosInput
): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  const cfg = getConfig();

  if (!input.consentGranted) {
    return {
      content: [
        {
          type: "text",
          text: "Consent is required before storing photos for try-on.",
        },
      ],
      structuredContent: { ok: false, reason: "consent_required" },
    };
  }

  await grantConsent({
    userId,
    consentType: "tryon_photos",
    granted: true,
    metadata: { source: input.source },
  });

  if (cfg.TRYON_REQUIRE_FULL_BODY_PHOTOS && (!input.photoUrls || input.photoUrls.length === 0)) {
    return {
      content: [
        {
          type: "text",
          text: "Please provide photoUrls (server-retrievable URLs) for full-body validation and try-on. Upload a full head-to-toe front-facing photo with feet visible.",
        },
      ],
      structuredContent: {
        ok: false,
        reason: "photo_urls_required",
        requirement: "full_head_to_toe_front_facing",
      },
    };
  }

  const photoSet = await createPhotoSet({
    userId,
    source: input.source,
    fileIds: input.fileIds,
    photoUrls: input.photoUrls,
  });

  let failedPhotos: Array<{
    index: number;
    reason: string;
    reasons: string[];
    width: number;
    height: number;
    aspectRatio: number;
    provider: "heuristic" | "strict";
  }> = [];
  let approvedPhotoCount = 0;
  let rejectedPhotoCount = 0;

  if (cfg.TRYON_REQUIRE_FULL_BODY_PHOTOS && input.photoUrls?.length) {
    const checks = await Promise.all(
      input.photoUrls.map((url) => validateFullBodyPhotoUrl(url))
    );
    const hasAnyFailure = checks.some((check) => !check.ok);

    const updates: PhotoValidationUpdate[] = checks.map((check, index) => {
      const status: PhotoValidationUpdate["status"] =
        hasAnyFailure || !check.ok ? "rejected" : "approved";
      const reasons = (check.reasons ?? (check.ok ? [] : [check.reason])).filter(
        (value) => value !== "ok"
      );
      return {
        index,
        status,
        isPrimary: !hasAnyFailure && check.ok && index === 0,
        report: {
          ok: check.ok,
          reason: check.reason,
          reasons,
          width: check.width,
          height: check.height,
          aspectRatio: check.aspectRatio,
          provider: check.provider,
          requirement: "full_head_to_toe_front_facing",
        },
      };
    });

    const summary = await setPhotoValidationResults({
      userId,
      photoSetId: photoSet.photoSetId,
      updates,
    });
    approvedPhotoCount = summary.approvedCount;
    rejectedPhotoCount = summary.rejectedCount;

    failedPhotos = checks
      .map((check, index) => ({ check, index }))
      .filter((entry) => !entry.check.ok)
      .map((entry) => ({
        index: entry.index,
        reason: entry.check.reason,
        reasons: entry.check.reasons ?? [entry.check.reason],
        width: entry.check.width,
        height: entry.check.height,
        aspectRatio: entry.check.aspectRatio,
        provider: entry.check.provider,
      }));
  }

  await writeAuditEvent({
    actorUserId: userId,
    eventType: "photos.ingested",
    entityType: "photo_set",
    entityId: photoSet.photoSetId,
    payload: {
      fileCount: photoSet.fileCount,
      source: input.source,
      approvedPhotoCount,
      rejectedPhotoCount,
      fullBodyRequired: cfg.TRYON_REQUIRE_FULL_BODY_PHOTOS,
    },
  });

  if (failedPhotos.length > 0) {
    const uniqueReasons = Array.from(
      new Set(
        failedPhotos
          .flatMap((p) => p.reasons ?? [])
          .filter((r) => typeof r === "string" && r.length > 0)
      )
    );
    const guidance = uniqueReasons
      .map((r) => humanGuidanceForFullBodyReason(r))
      .filter((v): v is string => Boolean(v))
      .slice(0, 6);
    const guidanceText =
      guidance.length > 0 ? `\n\nFixes:\n- ${guidance.join("\n- ")}` : "";

    return {
      content: [
        {
          type: "text",
          text:
            "Please upload a clear full head-to-toe front-facing photo with feet visible. We rejected this upload because one or more photos did not meet the requirement." +
            guidanceText,
        },
      ],
      structuredContent: {
        ok: false,
        reason: "full_body_photo_required",
        requirement: "full_head_to_toe_front_facing",
        photoSetId: photoSet.photoSetId,
        fileCount: photoSet.fileCount,
        failedPhotos,
      },
    };
  }

  return {
    content: [
      {
        type: "text",
        text: input.photoUrls?.length
          ? `Stored ${photoSet.fileCount} photo(s) for try-on rendering.`
          : `Stored ${photoSet.fileCount} photo reference(s). Provide photoUrls for server-side try-on rendering.`,
      },
    ],
    structuredContent: {
      ok: true,
      photoSetId: photoSet.photoSetId,
      fileCount: photoSet.fileCount,
      hasRenderablePhotoUrls: Boolean(input.photoUrls?.length),
      approvedPhotoCount,
      rejectedPhotoCount,
      requirement: cfg.TRYON_REQUIRE_FULL_BODY_PHOTOS
        ? "full_head_to_toe_front_facing"
        : "none",
    },
  };
}

export async function deletePhotosDomain(
  userId: string,
  input: DeletePhotosInput
): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  const deleted = await deletePhotoSet({ userId, photoSetId: input.photoSetId });
  if (!deleted) {
    return {
      content: [{ type: "text", text: "Photo set not found." }],
      structuredContent: { ok: false, reason: "not_found" },
    };
  }

  await writeAuditEvent({
    actorUserId: userId,
    eventType: "photos.deleted",
    entityType: "photo_set",
    entityId: input.photoSetId,
  });

  return {
    content: [{ type: "text", text: "Photo set deleted." }],
    structuredContent: { ok: true },
  };
}

export async function setAddressDomain(userId: string, address: Record<string, unknown>): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  await upsertDefaultAddress({ userId, address });
  await writeAuditEvent({
    actorUserId: userId,
    eventType: "profile.address.set",
    entityType: "profile",
    entityId: userId,
  });
  return {
    content: [{ type: "text", text: "Address received." }],
    structuredContent: { ok: true, address },
  };
}

import { Jimp } from "jimp";
import { getConfig } from "../config.js";
import { fetchAssetBuffer } from "../media/assetStore.js";

export type FullBodyFailureReason =
  | "image_too_small"
  | "not_head_to_toe_likely"
  | "image_fetch_failed"
  | "validator_unavailable"
  | "validator_invalid_response"
  | "no_person_detected"
  | "multiple_people_detected"
  | "not_front_facing"
  | "feet_missing"
  | "head_missing"
  | "too_blurry"
  | "too_dark"
  | "body_landmarks_low_confidence";

export type FullBodyFrameCheck = {
  ok: boolean;
  reason: "ok" | FullBodyFailureReason;
  reasons?: FullBodyFailureReason[];
  width: number;
  height: number;
  aspectRatio: number;
  provider: "heuristic" | "strict";
};

export type FullBodyValidatorHealth = {
  mode: "heuristic" | "strict";
  status: "up" | "down" | "skipped";
  endpoint: string | null;
  detail?: string;
};

function resolveValidatorHealthUrl(validateUrl: string): string {
  try {
    const parsed = new URL(validateUrl);
    parsed.pathname = parsed.pathname.replace(/\/validate\/?$/, "/healthz");
    if (!parsed.pathname.endsWith("/healthz")) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/healthz`;
    }
    return parsed.toString();
  } catch {
    return validateUrl.replace(/\/validate\/?$/, "/healthz");
  }
}

export async function checkFullBodyValidatorHealth(): Promise<FullBodyValidatorHealth> {
  const cfg = getConfig();
  if (cfg.FULLBODY_VALIDATOR_MODE !== "strict") {
    return {
      mode: cfg.FULLBODY_VALIDATOR_MODE,
      status: "skipped",
      endpoint: null,
      detail: "strict_mode_not_enabled",
    };
  }

  const endpoint = resolveValidatorHealthUrl(cfg.FULLBODY_VALIDATOR_URL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(5_000, cfg.FULLBODY_VALIDATOR_TIMEOUT_MS));
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        mode: cfg.FULLBODY_VALIDATOR_MODE,
        status: "down",
        endpoint,
        detail: `http_${response.status}`,
      };
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (payload.ok === false) {
      return {
        mode: cfg.FULLBODY_VALIDATOR_MODE,
        status: "down",
        endpoint,
        detail: "validator_reported_not_ok",
      };
    }
    return {
      mode: cfg.FULLBODY_VALIDATOR_MODE,
      status: "up",
      endpoint,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "request_failed";
    return {
      mode: cfg.FULLBODY_VALIDATOR_MODE,
      status: "down",
      endpoint,
      detail,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function evaluateFullBodyFrame(input: {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  minAspectRatio: number;
}): FullBodyFrameCheck {
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  const aspectRatio = height / width;

  if (width < input.minWidth || height < input.minHeight) {
    return {
      ok: false,
      reason: "image_too_small",
      reasons: ["image_too_small"],
      width,
      height,
      aspectRatio,
      provider: "heuristic",
    };
  }

  if (aspectRatio < input.minAspectRatio) {
    return {
      ok: false,
      reason: "not_head_to_toe_likely",
      reasons: ["not_head_to_toe_likely"],
      width,
      height,
      aspectRatio,
      provider: "heuristic",
    };
  }

  return {
    ok: true,
    reason: "ok",
    reasons: [],
    width,
    height,
    aspectRatio,
    provider: "heuristic",
  };
}

type StrictValidatorPayload = {
  approved: boolean;
  reasons: FullBodyFailureReason[];
  width: number;
  height: number;
  aspectRatio: number;
};

const STRICT_REASON_MAP: Record<string, FullBodyFailureReason> = {
  no_person_detected: "no_person_detected",
  multiple_people_detected: "multiple_people_detected",
  image_too_small: "image_too_small",
  too_blurry: "too_blurry",
  too_dark: "too_dark",
  not_front_facing: "not_front_facing",
  feet_missing: "feet_missing",
  head_missing: "head_missing",
  body_landmarks_low_confidence: "body_landmarks_low_confidence",
  not_head_to_toe_likely: "not_head_to_toe_likely",
};

function normalizeStrictReason(reason: unknown): FullBodyFailureReason | null {
  if (typeof reason !== "string") return null;
  return STRICT_REASON_MAP[reason] ?? null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function defaultFailedResult(
  reason: FullBodyFailureReason,
  fallback: { width?: number; height?: number; aspectRatio?: number } = {}
): FullBodyFrameCheck {
  return {
    ok: false,
    reason,
    reasons: [reason],
    width: Math.max(0, Math.floor(fallback.width ?? 0)),
    height: Math.max(0, Math.floor(fallback.height ?? 0)),
    aspectRatio: Math.max(0, fallback.aspectRatio ?? 0),
    provider: "strict",
  };
}

function parseStrictValidatorPayload(
  payload: unknown,
  fallback: { width: number; height: number; aspectRatio: number }
): StrictValidatorPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;

  const approved = root.approved === true;
  const reasonsRaw = Array.isArray(root.reasons) ? root.reasons : [];
  const reasons = reasonsRaw
    .map((value) => normalizeStrictReason(value))
    .filter((value): value is FullBodyFailureReason => value !== null);

  const metrics = root.metrics && typeof root.metrics === "object"
    ? (root.metrics as Record<string, unknown>)
    : {};
  const checks = root.checks && typeof root.checks === "object"
    ? (root.checks as Record<string, unknown>)
    : {};

  const width = Math.max(
    0,
    Math.floor(readNumber(metrics.width) ?? fallback.width)
  );
  const height = Math.max(
    0,
    Math.floor(readNumber(metrics.height) ?? fallback.height)
  );
  const aspectRatio = Math.max(
    0,
    readNumber(metrics.aspectRatio) ?? fallback.aspectRatio
  );

  if (checks.frontFacing === false && !reasons.includes("not_front_facing")) {
    reasons.push("not_front_facing");
  }

  const cfg = getConfig();
  if (cfg.FULLBODY_REQUIRE_FEET_VISIBLE && checks.feetVisible === false && !reasons.includes("feet_missing")) {
    reasons.push("feet_missing");
  }

  return { approved, reasons, width, height, aspectRatio };
}

async function callStrictFullBodyValidator(input: {
  url: string;
  imageBuffer: Buffer;
  mimeType: string;
  fallback: { width: number; height: number; aspectRatio: number };
}): Promise<FullBodyFrameCheck> {
  const cfg = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.FULLBODY_VALIDATOR_TIMEOUT_MS);
  try {
    const response = await fetch(cfg.FULLBODY_VALIDATOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        imageUrl: input.url,
        imageBase64: input.imageBuffer.toString("base64"),
        mimeType: input.mimeType,
        checks: {
          requireFeetVisible: cfg.FULLBODY_REQUIRE_FEET_VISIBLE,
        },
      }),
    });

    if (!response.ok) {
      return defaultFailedResult("validator_unavailable", input.fallback);
    }

    const payload = await response.json().catch(() => null);
    const parsed = parseStrictValidatorPayload(payload, input.fallback);
    if (!parsed) {
      return defaultFailedResult("validator_invalid_response", input.fallback);
    }

    if (parsed.approved) {
      return {
        ok: true,
        reason: "ok",
        reasons: [],
        width: parsed.width,
        height: parsed.height,
        aspectRatio: parsed.aspectRatio,
        provider: "strict",
      };
    }

    const reason = parsed.reasons[0] ?? "not_head_to_toe_likely";
    return {
      ok: false,
      reason,
      reasons: parsed.reasons.length > 0 ? parsed.reasons : [reason],
      width: parsed.width,
      height: parsed.height,
      aspectRatio: parsed.aspectRatio,
      provider: "strict",
    };
  } catch {
    return defaultFailedResult("validator_unavailable", input.fallback);
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateFullBodyPhotoUrl(url: string): Promise<FullBodyFrameCheck> {
  const cfg = getConfig();

  try {
    const fetched = await fetchAssetBuffer({ url, timeoutMs: cfg.FULLBODY_VALIDATOR_TIMEOUT_MS });
    const imageBuffer = fetched.buffer;
    const image = await Jimp.read(imageBuffer);
    const heuristic = evaluateFullBodyFrame({
      width: image.bitmap.width,
      height: image.bitmap.height,
      minWidth: cfg.TRYON_MIN_FULL_BODY_WIDTH_PX,
      minHeight: cfg.TRYON_MIN_FULL_BODY_HEIGHT_PX,
      minAspectRatio: cfg.TRYON_MIN_FULL_BODY_ASPECT_RATIO,
    });
    if (!heuristic.ok) {
      return heuristic;
    }

    if (cfg.FULLBODY_VALIDATOR_MODE !== "strict") {
      return heuristic;
    }

    const mimeType = fetched.mimeType ?? "image/jpeg";
    return callStrictFullBodyValidator({
      url,
      imageBuffer,
      mimeType,
      fallback: {
        width: heuristic.width,
        height: heuristic.height,
        aspectRatio: heuristic.aspectRatio,
      },
    });
  } catch {
    return defaultFailedResult("image_fetch_failed");
  }
}

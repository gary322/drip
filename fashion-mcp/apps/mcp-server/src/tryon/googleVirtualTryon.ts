import { GoogleAuth } from "google-auth-library";
import { getConfig } from "../config.js";

const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function detectImageMimeType(buffer: Buffer): string {
  if (buffer.length >= 8) {
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    if (isPng) return "image/png";
  }

  if (buffer.length >= 3) {
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (isJpeg) return "image/jpeg";
  }

  // Vertex supports common image formats; defaulting to jpeg is reasonable for unknowns.
  return "image/jpeg";
}

async function getGoogleAccessToken(): Promise<string> {
  const explicitToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (explicitToken) return explicitToken;

  const credsJson =
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ??
    null;

  let auth: GoogleAuth;
  if (credsJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(credsJson);
    } catch {
      throw new Error("google_credentials_json_invalid");
    }
    auth = new GoogleAuth({ credentials: parsed as any, scopes: [GOOGLE_CLOUD_PLATFORM_SCOPE] });
  } else {
    // Default Application Default Credentials (ADC). For local dev this is typically
    // `GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json`. On AWS, prefer the JSON env var above.
    auth = new GoogleAuth({ scopes: [GOOGLE_CLOUD_PLATFORM_SCOPE] });
  }

  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
  if (!token) {
    throw new Error("google_vertex_access_token_unavailable");
  }
  return token;
}

function extractPredictionImageBase64(payload: unknown): string | null {
  const root = payload as Record<string, any> | null;
  const predictions = Array.isArray(root?.predictions) ? root?.predictions : [];
  if (predictions.length === 0) return null;

  const first = predictions[0] as Record<string, any>;
  if (typeof first?.bytesBase64Encoded === "string" && first.bytesBase64Encoded.length > 0) {
    return first.bytesBase64Encoded;
  }

  const images = Array.isArray(first?.images) ? first.images : [];
  for (const image of images) {
    if (typeof image?.bytesBase64Encoded === "string" && image.bytesBase64Encoded.length > 0) {
      return image.bytesBase64Encoded;
    }
  }

  const candidates = [first?.image, first?.outputImage];
  for (const candidate of candidates) {
    if (typeof candidate?.bytesBase64Encoded === "string" && candidate.bytesBase64Encoded.length > 0) {
      return candidate.bytesBase64Encoded;
    }
  }

  return null;
}

export async function renderTryonWithGoogleVertex(input: {
  userImageBuffer: Buffer;
  garmentImageBuffer: Buffer;
}): Promise<Buffer> {
  const cfg = getConfig();
  const projectId = cfg.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("google_vertex_project_not_configured");
  }

  const endpoint = `https://${cfg.GOOGLE_CLOUD_LOCATION}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/locations/${encodeURIComponent(cfg.GOOGLE_CLOUD_LOCATION)}/publishers/google/models/${encodeURIComponent(
    cfg.GOOGLE_VERTEX_VTO_MODEL
  )}:predict`;

  const token = await getGoogleAccessToken();
  const userMime = detectImageMimeType(input.userImageBuffer);
  const garmentMime = detectImageMimeType(input.garmentImageBuffer);

  const body = {
    instances: [
      {
        personImage: {
          image: {
            bytesBase64Encoded: input.userImageBuffer.toString("base64"),
            mimeType: userMime,
          },
        },
        productImages: [
          {
            image: {
              bytesBase64Encoded: input.garmentImageBuffer.toString("base64"),
              mimeType: garmentMime,
            },
          },
        ],
      },
    ],
    parameters: {
      sampleCount: 1,
      addWatermark: cfg.GOOGLE_VERTEX_VTO_ADD_WATERMARK,
      baseSteps: cfg.GOOGLE_VERTEX_VTO_BASE_STEPS,
      personGeneration: cfg.GOOGLE_VERTEX_VTO_PERSON_GENERATION,
      safetySetting: cfg.GOOGLE_VERTEX_VTO_SAFETY_SETTING,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.GOOGLE_VERTEX_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(
        `google_vertex_tryon_request_failed:${response.status}:${responseText.slice(0, 500)}`
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new Error("google_vertex_tryon_invalid_json_response");
    }

    const imageBase64 = extractPredictionImageBase64(parsed);
    if (!imageBase64) {
      throw new Error("google_vertex_tryon_missing_image_in_response");
    }
    return Buffer.from(imageBase64, "base64");
  } finally {
    clearTimeout(timeout);
  }
}

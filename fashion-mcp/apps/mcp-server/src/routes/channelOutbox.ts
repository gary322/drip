import express from "express";
import { getConfig } from "../config.js";
import {
  claimNextOutboundChannelMessage,
  markChannelMessageFailed,
  markChannelMessageSent,
} from "../db/repos/channelRepo.js";
import { storeInboundImage, isSupportedImageMimeType } from "../media/storage.js";
import { parseChannelInboundEvent } from "../channels/types.js";
import { handleChannelInboundEvent } from "../channels/orchestrator.js";

export const channelOutboxRoutes = express.Router();

function requireBridgeAuth(req: express.Request, res: express.Response): boolean {
  const cfg = getConfig();
  if (!cfg.IMESSAGE_BRIDGE_ENABLED) {
    res.status(503).json({ error: "imessage_bridge_disabled" });
    return false;
  }

  const header = req.header("authorization") ?? "";
  const expected = `Bearer ${cfg.IMESSAGE_BRIDGE_SHARED_SECRET}`;
  if (header !== expected) {
    res.status(401).json({ error: "unauthorized_bridge" });
    return false;
  }
  return true;
}

channelOutboxRoutes.post("/channels/outbox/claim", async (req, res) => {
  if (!requireBridgeAuth(req, res)) return;
  const body = (req.body ?? {}) as any;
  const channel = String(body.channel ?? "imessage");
  const maxBatchSize = Math.max(1, Math.min(25, Number(body.maxBatchSize ?? 10)));
  if (channel !== "imessage") {
    return res.status(400).json({ error: "unsupported_channel" });
  }

  const messages: any[] = [];
  for (let i = 0; i < maxBatchSize; i += 1) {
    const next = await claimNextOutboundChannelMessage({ channel: "imessage" });
    if (!next) break;
    messages.push({ id: next.id, payload: next.payload });
  }

  return res.status(200).json({ ok: true, messages });
});

channelOutboxRoutes.post("/channels/outbox/:id/sent", async (req, res) => {
  if (!requireBridgeAuth(req, res)) return;
  const id = req.params.id;
  const body = (req.body ?? {}) as any;
  await markChannelMessageSent({
    channelMessageId: id,
    providerMessageId: typeof body.providerMessageId === "string" ? body.providerMessageId : undefined,
    responseCode: typeof body.responseCode === "number" ? body.responseCode : undefined,
    responseBody: typeof body.responseBody === "string" ? body.responseBody : undefined,
  });
  return res.status(200).json({ ok: true });
});

channelOutboxRoutes.post("/channels/outbox/:id/failed", async (req, res) => {
  if (!requireBridgeAuth(req, res)) return;
  const id = req.params.id;
  const body = (req.body ?? {}) as any;
  const error = typeof body.error === "string" ? body.error : "send_failed";
  const result = await markChannelMessageFailed({ channelMessageId: id, error });
  return res.status(200).json({ ok: true, deadLettered: result.deadLettered });
});

channelOutboxRoutes.post("/channels/imessage/events", async (req, res) => {
  if (!requireBridgeAuth(req, res)) return;
  const event = parseChannelInboundEvent(req.body);
  if (event.channel !== "imessage") {
    return res.status(400).json({ error: "invalid_channel" });
  }
  const result = await handleChannelInboundEvent(event);
  return res.status(200).json({ ok: true, result });
});

function decodeBase64Payload(dataBase64: string): Buffer {
  const trimmed = String(dataBase64 ?? "").trim();
  const comma = trimmed.indexOf(",");
  const raw = trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  // Buffer.from will silently produce empty output for invalid input; callers must validate length.
  return Buffer.from(raw, "base64");
}

// Upload endpoint used by the iMessage bridge for attachments (since the backend cannot read local macOS paths).
channelOutboxRoutes.post("/channels/imessage/upload", async (req, res) => {
  if (!requireBridgeAuth(req, res)) return;
  const body = (req.body ?? {}) as any;
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
  const prefix = typeof body.prefix === "string" ? body.prefix : "imsg";

  if (!dataBase64) {
    return res.status(400).json({ error: "missing_data" });
  }
  if (mimeType && !isSupportedImageMimeType(mimeType)) {
    return res.status(400).json({ error: "unsupported_mime_type" });
  }

  const buffer = decodeBase64Payload(dataBase64);
  if (buffer.length === 0) {
    return res.status(400).json({ error: "invalid_base64" });
  }

  try {
    const stored = await storeInboundImage({ buffer, mimeType: mimeType || undefined, prefix });
    return res.status(200).json({
      ok: true,
      media: {
        mediaId: stored.mediaId,
        mimeType: stored.mimeType,
        bytes: stored.bytes,
        remoteUrl: stored.storageUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "media_too_large" ? 413 : 500;
    return res.status(status).json({ error: "upload_failed", detail: message });
  }
});

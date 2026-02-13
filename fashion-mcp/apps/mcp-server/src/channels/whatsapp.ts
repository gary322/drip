import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";
import { storeInboundImage } from "../media/storage.js";
import type { ChannelInboundEvent } from "./types.js";

type WhatsAppWebhookRoot = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: any;
    }>;
  }>;
};

type WhatsAppInboundMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
};

export function verifyWhatsAppSignature(input: {
  appSecret: string;
  rawBody: Buffer;
  signatureHeader: string | undefined;
}): boolean {
  const header = input.signatureHeader ?? "";
  const match = header.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) return false;
  const sent = Buffer.from(match[1], "hex");

  const expectedHex = createHmac("sha256", input.appSecret).update(input.rawBody).digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== sent.length) return false;
  return timingSafeEqual(expected, sent);
}

function extractInboundMessages(payload: WhatsAppWebhookRoot): WhatsAppInboundMessage[] {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const messages: WhatsAppInboundMessage[] = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const msgList = Array.isArray(value?.messages) ? value.messages : [];
      for (const msg of msgList) {
        if (!msg || typeof msg !== "object") continue;
        if (typeof msg.id !== "string" || typeof msg.from !== "string") continue;
        messages.push(msg as WhatsAppInboundMessage);
      }
    }
  }

  return messages;
}

async function fetchWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const cfg = getConfig();
  if (!cfg.WHATSAPP_ACCESS_TOKEN) {
    throw new Error("whatsapp_access_token_not_configured");
  }

  const base = cfg.WHATSAPP_API_BASE_URL.replace(/\/$/, "");
  const version = cfg.WHATSAPP_API_VERSION;

  const metaRes = await fetch(`${base}/${version}/${encodeURIComponent(mediaId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}` },
  });
  const metaText = await metaRes.text();
  if (!metaRes.ok) {
    throw new Error(`whatsapp_media_meta_failed:${metaRes.status}:${metaText.slice(0, 200)}`);
  }
  let meta: any;
  try {
    meta = JSON.parse(metaText);
  } catch {
    throw new Error("whatsapp_media_meta_invalid_json");
  }

  const url = typeof meta?.url === "string" ? meta.url : null;
  const mimeType = typeof meta?.mime_type === "string" ? meta.mime_type : "image/jpeg";
  if (!url) {
    throw new Error("whatsapp_media_meta_missing_url");
  }

  const fileRes = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!fileRes.ok) {
    throw new Error(`whatsapp_media_download_failed:${fileRes.status}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mimeType };
}

export async function buildWhatsAppInboundEvents(input: {
  payload: unknown;
  signatureValidated: boolean;
}): Promise<ChannelInboundEvent[]> {
  const cfg = getConfig();
  if (!cfg.WHATSAPP_ENABLED) {
    return [];
  }

  const root = (input.payload ?? {}) as WhatsAppWebhookRoot;
  const messages = extractInboundMessages(root);

  const events: ChannelInboundEvent[] = [];
  for (const message of messages) {
    const receivedAt = new Date(Number(message.timestamp) * 1000).toISOString();
    const media = [];

    if (message.type === "image" && message.image?.id) {
      const mediaId = message.image.id;
      const fetched = await fetchWhatsAppMedia(mediaId);
      const stored = await storeInboundImage({
        buffer: fetched.buffer,
        mimeType: fetched.mimeType,
        prefix: "wa",
      });
      media.push({
        mediaId,
        mimeType: stored.mimeType,
        remoteUrl: stored.storageUrl,
        caption: message.image.caption,
      });
    }

    const text = message.type === "text" ? message.text?.body : undefined;
    const event: ChannelInboundEvent = {
      eventId: message.id,
      channel: "whatsapp",
      channelUserId: message.from,
      channelConversationId: message.from,
      receivedAt,
      text: typeof text === "string" && text.trim().length > 0 ? text : undefined,
      media,
      metadata: {
        type: message.type,
      },
      signatureValidated: input.signatureValidated,
    };
    events.push(event);
  }

  return events;
}

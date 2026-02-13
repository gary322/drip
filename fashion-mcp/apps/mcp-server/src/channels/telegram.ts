import { getConfig } from "../config.js";
import { storeInboundImage } from "../media/storage.js";
import type { ChannelInboundEvent } from "./types.js";

type TelegramUpdate = Record<string, any>;

function pickBestPhotoId(photos: any[]): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const sorted = [...photos].sort((a, b) => Number(b.file_size ?? 0) - Number(a.file_size ?? 0));
  const best = sorted[0];
  return typeof best?.file_id === "string" ? best.file_id : null;
}

async function telegramApiCall(path: string, init: RequestInit): Promise<{ ok: boolean; status: number; text: string }> {
  const cfg = getConfig();
  if (!cfg.TELEGRAM_BOT_TOKEN) {
    throw new Error("telegram_bot_token_not_configured");
  }

  const base = cfg.TELEGRAM_API_BASE_URL.replace(/\/$/, "");
  const url = `${base}/bot${cfg.TELEGRAM_BOT_TOKEN}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function fetchTelegramPhoto(fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const getFile = await telegramApiCall(`getFile?file_id=${encodeURIComponent(fileId)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!getFile.ok) {
    throw new Error(`telegram_getfile_failed:${getFile.status}:${getFile.text.slice(0, 200)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(getFile.text);
  } catch {
    throw new Error("telegram_getfile_invalid_json");
  }

  const filePath = typeof parsed?.result?.file_path === "string" ? parsed.result.file_path : null;
  if (!filePath) {
    throw new Error("telegram_getfile_missing_path");
  }

  const cfg = getConfig();
  const base = cfg.TELEGRAM_API_BASE_URL.replace(/\/$/, "");
  const downloadUrl = `${base}/file/bot${cfg.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const fileRes = await fetch(downloadUrl, { method: "GET" });
  if (!fileRes.ok) {
    throw new Error(`telegram_file_download_failed:${fileRes.status}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, mimeType: "image/jpeg" };
}

export async function buildTelegramInboundEvent(input: {
  update: unknown;
  signatureValidated: boolean;
}): Promise<ChannelInboundEvent | null> {
  const cfg = getConfig();
  if (!cfg.TELEGRAM_ENABLED) return null;

  const update = (input.update ?? {}) as TelegramUpdate;
  const message = update.message ?? update.edited_message ?? null;
  if (!message) return null;

  const chatId = message.chat?.id;
  const fromId = message.from?.id;
  const messageId = message.message_id;
  if (chatId == null || fromId == null || messageId == null) return null;

  const receivedAt = new Date(Number(message.date ?? 0) * 1000).toISOString();
  const text = typeof message.text === "string" ? message.text : undefined;
  const caption = typeof message.caption === "string" ? message.caption : undefined;

  const media: Array<{ mediaId: string; mimeType: string; remoteUrl?: string; caption?: string }> = [];
  const bestPhotoId = pickBestPhotoId(message.photo);
  if (bestPhotoId) {
    const fetched = await fetchTelegramPhoto(bestPhotoId);
    const stored = await storeInboundImage({
      buffer: fetched.buffer,
      mimeType: fetched.mimeType,
      prefix: "tg",
    });
    media.push({
      mediaId: bestPhotoId,
      mimeType: stored.mimeType,
      remoteUrl: stored.storageUrl,
      caption,
    });
  }

  const eventId = `tg:${chatId}:${messageId}`;
  return {
    eventId,
    channel: "telegram",
    channelUserId: String(fromId),
    channelConversationId: String(chatId),
    receivedAt,
    text: text && text.trim().length > 0 ? text : undefined,
    media,
    metadata: {
      updateId: update.update_id ?? null,
      messageId,
    },
    signatureValidated: input.signatureValidated,
  };
}

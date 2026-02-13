import { getConfig } from "./config.js";
import { createBackendClient } from "./backendClient.js";
import { spawnImsgRpc, type ImsgMessage, type ImsgAttachment } from "./imsgRpc.js";
import { buildTextFromParts, pickFirstImage } from "./messageFormat.js";
import { readSinceRowId, writeSinceRowId } from "./state.js";
import { guessExtensionFromMimeType, withTempFile } from "./files.js";
import { readFile } from "node:fs/promises";
import type { ChannelInboundEvent } from "@fashion/shared";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeReceivedAt(value: string | null | undefined): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function buildEventId(message: ImsgMessage): string {
  if (isNonEmptyString(message.guid)) return message.guid.trim();
  return `imsg:${message.chat_id}:${message.id}`;
}

function guessSenderId(message: ImsgMessage): string {
  if (isNonEmptyString(message.sender)) return message.sender.trim();
  if (isNonEmptyString(message.chat_identifier)) return message.chat_identifier.trim();
  return String(message.chat_id);
}

function isImageAttachment(att: ImsgAttachment): boolean {
  const mime = String(att.mime_type ?? "").toLowerCase();
  return Boolean(att.original_path) && att.missing !== true && mime.startsWith("image/");
}

async function downloadToBuffer(url: string, timeoutMs = 30_000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`download_failed:${res.status}:${text.slice(0, 200)}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const cfg = getConfig();
  const backend = createBackendClient({
    baseUrl: cfg.BACKEND_BASE_URL,
    sharedSecret: cfg.BRIDGE_SHARED_SECRET,
  });
  const imsg = spawnImsgRpc({ bin: cfg.IMSG_BIN });

  const sinceRowId = await readSinceRowId(cfg.STATE_DIR);
  const subscription = await imsg.subscribeWatch({
    ...(cfg.IMSG_WATCH_CHAT_ID ? { chat_id: cfg.IMSG_WATCH_CHAT_ID } : {}),
    ...(sinceRowId ? { since_rowid: sinceRowId } : {}),
    attachments: cfg.IMSG_ATTACHMENTS ?? true,
  });

  console.log(JSON.stringify({ ok: true, component: "imsg-bridge", subscription, sinceRowId: sinceRowId ?? null }));

  let inboundChain = Promise.resolve();
  let maxSeenRowId = sinceRowId ?? 0;

  imsg.onNotification((note) => {
    if (note.method !== "message") return;
    const params = note.params as any;
    const message = params?.message as ImsgMessage | undefined;
    if (!message) return;
    if (message.is_from_me) return;

    inboundChain = inboundChain
      .then(async () => {
        const attachments = Array.isArray(message.attachments) ? message.attachments : [];
        const media = [];

        for (const att of attachments) {
          if (!isImageAttachment(att)) continue;
          const path = String(att.original_path);
          const mimeType = String(att.mime_type ?? "image/jpeg");
          try {
            const dataBase64 = (await readFile(path)).toString("base64");
            const uploaded = await backend.uploadImage({ mimeType, dataBase64, prefix: "imsg" });
            media.push({
              mediaId: uploaded.mediaId,
              mimeType: uploaded.mimeType,
              remoteUrl: uploaded.remoteUrl,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`attachment_upload_failed:${msg}`);
          }
        }

        const event: ChannelInboundEvent = {
          eventId: buildEventId(message),
          channel: "imessage",
          channelUserId: guessSenderId(message),
          channelConversationId: String(message.chat_id),
          receivedAt: normalizeReceivedAt(message.created_at),
          ...(isNonEmptyString(message.text) ? { text: message.text.trim() } : {}),
          media,
          metadata: {
            chatId: message.chat_id,
            guid: message.guid ?? null,
            participants: message.participants ?? null,
            isGroup: message.is_group ?? null,
          },
          signatureValidated: true,
        };

        await backend.postInboundEvent(event);

        if (typeof message.id === "number" && message.id > maxSeenRowId) {
          maxSeenRowId = message.id;
          await writeSinceRowId(cfg.STATE_DIR, maxSeenRowId);
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`inbound_error:${msg}`);
      });
  });

  let stopped = false;
  const stop = () => {
    stopped = true;
    imsg.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopped) {
    try {
      const claimed = await backend.claimOutbox({ channel: "imessage", maxBatchSize: cfg.OUTBOX_MAX_BATCH_SIZE });
      for (const row of claimed) {
        try {
          const outbound = row.payload;
          const textBody = buildTextFromParts(outbound.parts);
          const image = pickFirstImage(outbound.parts);

          if (image) {
            const buffer = await downloadToBuffer(image.imageUrl, 30_000);
            const ext = guessExtensionFromMimeType("image/jpeg");
            await withTempFile({ prefix: "imsg-outbound", extension: ext, buffer }, async (filePath) => {
              const chatId = Number(outbound.channelConversationId);
              const hasChatId = Number.isFinite(chatId) && chatId > 0;
              const caption = [image.caption, textBody].filter(Boolean).join("\n").trim();
              await imsg.send(
                hasChatId
                  ? {
                      chat_id: chatId,
                      text: caption.length > 0 ? caption : undefined,
                      file: filePath,
                      service: cfg.IMSG_SEND_SERVICE,
                      region: cfg.IMSG_REGION,
                    }
                  : {
                      to: outbound.recipientId,
                      text: caption.length > 0 ? caption : undefined,
                      file: filePath,
                      service: cfg.IMSG_SEND_SERVICE,
                      region: cfg.IMSG_REGION,
                    }
              );
            });
          } else {
            const chatId = Number(outbound.channelConversationId);
            const hasChatId = Number.isFinite(chatId) && chatId > 0;
            const body = textBody.length > 0 ? textBody : "OK.";
            await imsg.send(
              hasChatId
                ? { chat_id: chatId, text: body, service: cfg.IMSG_SEND_SERVICE, region: cfg.IMSG_REGION }
                : { to: outbound.recipientId, text: body, service: cfg.IMSG_SEND_SERVICE, region: cfg.IMSG_REGION }
            );
          }

          await backend.markSent({ id: row.id });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await backend.markFailed({ id: row.id, error: msg });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`outbox_error:${msg}`);
    }

    await new Promise((r) => setTimeout(r, cfg.OUTBOX_POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`fatal:${msg}`);
  process.exit(1);
});

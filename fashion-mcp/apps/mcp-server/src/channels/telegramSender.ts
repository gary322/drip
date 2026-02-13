import { getConfig } from "../config.js";
import type { ChannelSenderAdapter, ChannelSendResult } from "./senderWorker.js";
import { parseChannelOutboundMessage } from "./types.js";

type FetchLike = typeof fetch;

function buildTextFromParts(parts: Array<{ type: string; [k: string]: any }>): string {
  const lines: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      lines.push(part.text.trim());
    }
    if (part.type === "link" && typeof part.url === "string") {
      lines.push(part.url);
    }
  }
  return lines.filter(Boolean).join("\n").trim();
}

async function telegramApi(input: {
  fetchFn: FetchLike;
  path: string;
  payload: Record<string, unknown>;
}): Promise<ChannelSendResult> {
  const cfg = getConfig();
  if (!cfg.TELEGRAM_BOT_TOKEN) {
    throw new Error("telegram_not_configured");
  }
  const base = cfg.TELEGRAM_API_BASE_URL.replace(/\/$/, "");
  const url = `${base}/bot${cfg.TELEGRAM_BOT_TOKEN}/${input.path.replace(/^\//, "")}`;

  const res = await input.fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`telegram_send_failed:${res.status}:${text.slice(0, 300)}`);
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}

  const providerMessageId =
    typeof parsed?.result?.message_id === "number"
      ? String(parsed.result.message_id)
      : undefined;

  return {
    providerMessageId,
    responseCode: res.status,
    responseBody: text.slice(0, 500),
  };
}

export function createTelegramSender(options?: { fetchFn?: FetchLike }): ChannelSenderAdapter {
  const fetchFn = options?.fetchFn ?? fetch;
  return {
    send: async (messageRow) => {
      const outbound = parseChannelOutboundMessage(messageRow.payload);
      const parts = outbound.parts as any[];
      const image = parts.find((p) => p.type === "image" && typeof p.imageUrl === "string") as
        | { imageUrl: string; caption?: string }
        | undefined;

      const textBody = buildTextFromParts(parts);

      if (image) {
        const caption = [image.caption, textBody].filter(Boolean).join("\n").trim().slice(0, 1000);
        return telegramApi({
          fetchFn,
          path: "sendPhoto",
          payload: {
            chat_id: outbound.recipientId,
            photo: image.imageUrl,
            ...(caption ? { caption } : {}),
          },
        });
      }

      const body = textBody.length > 0 ? textBody : "OK.";
      return telegramApi({
        fetchFn,
        path: "sendMessage",
        payload: {
          chat_id: outbound.recipientId,
          text: body,
          disable_web_page_preview: false,
        },
      });
    },
  };
}

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

async function sendWhatsAppMessage(input: {
  fetchFn: FetchLike;
  payload: Record<string, unknown>;
}): Promise<ChannelSendResult> {
  const cfg = getConfig();
  if (!cfg.WHATSAPP_ACCESS_TOKEN || !cfg.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("whatsapp_not_configured");
  }

  const base = cfg.WHATSAPP_API_BASE_URL.replace(/\/$/, "");
  const version = cfg.WHATSAPP_API_VERSION;
  const url = `${base}/${version}/${encodeURIComponent(cfg.WHATSAPP_PHONE_NUMBER_ID)}/messages`;

  const response = await input.fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`whatsapp_send_failed:${response.status}:${text.slice(0, 300)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { responseCode: response.status, responseBody: text.slice(0, 500) };
  }

  const providerMessageId =
    Array.isArray(parsed?.messages) && typeof parsed.messages[0]?.id === "string"
      ? parsed.messages[0].id
      : undefined;

  return {
    providerMessageId,
    responseCode: response.status,
    responseBody: text.slice(0, 500),
  };
}

export function createWhatsAppSender(options?: { fetchFn?: FetchLike }): ChannelSenderAdapter {
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
        return sendWhatsAppMessage({
          fetchFn,
          payload: {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: outbound.recipientId,
            type: "image",
            image: {
              link: image.imageUrl,
              ...(caption ? { caption } : {}),
            },
          },
        });
      }

      const body = textBody.length > 0 ? textBody : "OK.";
      return sendWhatsAppMessage({
        fetchFn,
        payload: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: outbound.recipientId,
          type: "text",
          text: { body },
        },
      });
    },
  };
}

import { z } from "zod";
import {
  ChannelOutboundMessageSchema,
  type ChannelInboundEvent,
  type ChannelOutboundMessage,
} from "@fashion/shared";

type FetchLike = typeof fetch;

const UploadResponseSchema = z.object({
  ok: z.boolean(),
  media: z
    .object({
      mediaId: z.string().min(1),
      mimeType: z.string().min(1),
      bytes: z.number().int().nonnegative(),
      remoteUrl: z.string().url(),
    })
    .optional(),
});

const ClaimResponseSchema = z.object({
  ok: z.boolean(),
  messages: z.array(z.object({ id: z.string().min(1), payload: z.unknown() })),
});

export type BackendClient = {
  uploadImage: (input: { mimeType: string; dataBase64: string; prefix?: string }) => Promise<{
    mediaId: string;
    mimeType: string;
    bytes: number;
    remoteUrl: string;
  }>;
  postInboundEvent: (event: ChannelInboundEvent) => Promise<unknown>;
  claimOutbox: (input: { channel: "imessage"; maxBatchSize: number }) => Promise<Array<{ id: string; payload: ChannelOutboundMessage }>>;
  markSent: (input: { id: string; providerMessageId?: string; responseCode?: number; responseBody?: string }) => Promise<void>;
  markFailed: (input: { id: string; error: string }) => Promise<void>;
};

function withTimeout(timeoutMs: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
  };
}

export function createBackendClient(input: {
  baseUrl: string;
  sharedSecret: string;
  fetchFn?: FetchLike;
}): BackendClient {
  const fetchFn = input.fetchFn ?? fetch;
  const base = input.baseUrl.replace(/\/$/, "");
  const auth = `Bearer ${input.sharedSecret}`;

  async function postJson<T>(path: string, body: unknown, schema: z.ZodSchema<T>): Promise<T> {
    const { signal, done } = withTimeout(30_000);
    try {
      const res = await fetchFn(`${base}${path}`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`backend_http_${res.status}:${path}:${text.slice(0, 300)}`);
      }
      const parsed = JSON.parse(text) as unknown;
      return schema.parse(parsed);
    } finally {
      done();
    }
  }

  return {
    uploadImage: async ({ mimeType, dataBase64, prefix }) => {
      const payload = await postJson(
        "/channels/imessage/upload",
        { mimeType, dataBase64, prefix },
        UploadResponseSchema
      );
      if (!payload.ok || !payload.media) {
        throw new Error("backend_upload_failed");
      }
      return payload.media;
    },

    postInboundEvent: async (event) => {
      const { signal, done } = withTimeout(30_000);
      try {
        const res = await fetchFn(`${base}/channels/imessage/events`, {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify(event),
          signal,
        });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(`backend_inbound_http_${res.status}:${text.slice(0, 300)}`);
        }
        return JSON.parse(text);
      } finally {
        done();
      }
    },

    claimOutbox: async ({ channel, maxBatchSize }) => {
      const payload = await postJson(
        "/channels/outbox/claim",
        { channel, maxBatchSize },
        ClaimResponseSchema
      );
      if (!payload.ok) return [];
      const parsed: Array<{ id: string; payload: ChannelOutboundMessage }> = [];
      for (const msg of payload.messages) {
        try {
          // Validate using shared schema (runtime safety across the bridge boundary).
          const outbound = ChannelOutboundMessageSchema.parse(msg.payload);
          parsed.push({ id: msg.id, payload: outbound });
        } catch {
          // Drop invalid payloads; backend will retry until dead-letter, but bridge can't send invalid structures.
        }
      }
      return parsed;
    },

    markSent: async ({ id, providerMessageId, responseCode, responseBody }) => {
      await postJson(
        `/channels/outbox/${encodeURIComponent(id)}/sent`,
        { providerMessageId, responseCode, responseBody },
        z.object({ ok: z.boolean() })
      );
    },

    markFailed: async ({ id, error }) => {
      await postJson(
        `/channels/outbox/${encodeURIComponent(id)}/failed`,
        { error },
        z.object({ ok: z.boolean(), deadLettered: z.boolean().optional() })
      );
    },
  };
}

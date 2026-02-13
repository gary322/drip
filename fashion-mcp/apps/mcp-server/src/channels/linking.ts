import { getConfig } from "../config.js";
import {
  createChannelLinkToken,
  consumeChannelLinkToken,
  upsertChannelIdentity,
} from "../db/repos/channelRepo.js";
import type { ChannelType } from "./types.js";

type CreateLinkTokenDeps = {
  createToken: typeof createChannelLinkToken;
};

type CompleteLinkDeps = {
  consumeToken: typeof consumeChannelLinkToken;
  upsertIdentity: typeof upsertChannelIdentity;
};

export async function createChannelLinkRequest(
  input: {
    channel: ChannelType;
    channelUserId: string;
    channelConversationId: string;
    ttlMinutes?: number;
    metadata?: Record<string, unknown>;
  },
  deps: CreateLinkTokenDeps = {
    createToken: createChannelLinkToken,
  }
): Promise<{ token: string; expiresAt: string; linkUrl: string }> {
  const created = await deps.createToken({
    channel: input.channel,
    channelUserId: input.channelUserId,
    channelConversationId: input.channelConversationId,
    ttlMinutes: input.ttlMinutes,
    metadata: input.metadata,
  });

  const base = getConfig().PUBLIC_BASE_URL.replace(/\/$/, "");
  return {
    token: created.token,
    expiresAt: created.expiresAt,
    linkUrl: `${base}/channels/link/${created.token}`,
  };
}

export async function completeChannelLink(
  input: { token: string; userId: string },
  deps: CompleteLinkDeps = {
    consumeToken: consumeChannelLinkToken,
    upsertIdentity: upsertChannelIdentity,
  }
): Promise<
  | { ok: true; channel: ChannelType; channelUserId: string; channelConversationId: string }
  | { ok: false; reason: "invalid_or_expired_token" | "invalid_user_id" }
> {
  if (!input.userId || input.userId.trim().length === 0) {
    return { ok: false, reason: "invalid_user_id" };
  }

  const consumed = await deps.consumeToken({ token: input.token });
  if (!consumed) {
    return { ok: false, reason: "invalid_or_expired_token" };
  }

  await deps.upsertIdentity({
    userId: input.userId,
    channel: consumed.channel,
    channelUserId: consumed.channelUserId,
    channelConversationId: consumed.channelConversationId,
    status: "active",
    metadata: {
      linkedAt: new Date().toISOString(),
      ...(consumed.metadata ?? {}),
    },
  });

  return {
    ok: true,
    channel: consumed.channel,
    channelUserId: consumed.channelUserId,
    channelConversationId: consumed.channelConversationId,
  };
}

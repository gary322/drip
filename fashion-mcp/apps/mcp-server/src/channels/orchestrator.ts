import { randomUUID } from "node:crypto";
import type { ChannelInboundEvent, ChannelOutboundMessage } from "./types.js";
import type { ChannelMessagePart } from "@fashion/shared";
import { routeChannelEvent } from "./router.js";
import { executeRoutedToolCommand } from "./commandExecutor.js";
import { writeAuditEvent } from "../db/repos/auditRepo.js";
import {
  enqueueOutboundChannelMessage,
  getChannelIdentityByExternal,
  markInboundChannelMessageProcessed,
  recordInboundChannelMessage,
  upsertChannelIdentity,
} from "../db/repos/channelRepo.js";
import { createChannelLinkRequest } from "./linking.js";

function collectText(parts: ChannelMessagePart[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function formatOutfitPlan(structured: any): string | null {
  if (!structured || structured.type !== "outfit_plan") return null;
  const outfits = Array.isArray(structured.outfits) ? structured.outfits : [];
  const items = Array.isArray(structured.items) ? structured.items : [];

  const lines: string[] = [];
  lines.push(`Here are ${outfits.length} outfit option(s).`);
  if (items.length > 0) {
    lines.push("");
    lines.push("Items:");
    for (const item of items.slice(0, 12)) {
      const id = typeof item?.id === "string" ? item.id : "";
      const title = typeof item?.title === "string" ? item.title : "Item";
      const brand = typeof item?.brand === "string" ? item.brand : "";
      const price = item?.price?.amount != null ? `$${Number(item.price.amount).toFixed(2)}` : "";
      lines.push(`- ${id} ${brand ? `(${brand})` : ""}: ${title} ${price}`.trim());
    }
  }
  lines.push("");
  lines.push('Reply with: "try on prod_001" or "checkout prod_001 prod_002".');
  return lines.join("\n");
}

function toolResponsesToParts(responses: Array<{ content?: any[]; structuredContent?: any }>): ChannelMessagePart[] {
  const texts: string[] = [];
  for (const response of responses) {
    const content = Array.isArray(response.content) ? response.content : [];
    for (const item of content) {
      if (item?.type === "text" && typeof item?.text === "string" && item.text.trim().length > 0) {
        texts.push(item.text.trim());
      }
    }
  }

  const merged = texts.join("\n");
  if (merged.trim().length === 0) {
    return [{ type: "text", text: "OK." }];
  }
  return [{ type: "text", text: merged }];
}

function makeOutboundMessage(input: {
  channel: ChannelInboundEvent["channel"];
  correlationId: string;
  channelConversationId: string;
  recipientId: string;
  parts: ChannelMessagePart[];
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): ChannelOutboundMessage {
  return {
    messageId: randomUUID(),
    correlationId: input.correlationId,
    channel: input.channel,
    channelConversationId: input.channelConversationId,
    recipientId: input.recipientId,
    parts: input.parts,
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata ?? {},
  };
}

export async function handleChannelInboundEvent(event: ChannelInboundEvent): Promise<{
  ok: true;
  duplicate: boolean;
  inboundMessageId: string;
  correlationId: string;
  queuedOutbound: number;
  linkedUserId: string | null;
}> {
  // Ensure we have an identity row even before linking.
  const existingIdentity = await getChannelIdentityByExternal({
    channel: event.channel,
    channelUserId: event.channelUserId,
  });

  const identity =
    existingIdentity ??
    (await upsertChannelIdentity({
      channel: event.channel,
      channelUserId: event.channelUserId,
      channelConversationId: event.channelConversationId,
      status: "unlinked",
      metadata: { firstSeenAt: event.receivedAt },
    }));

  const correlationId = randomUUID();
  const inbound = await recordInboundChannelMessage({
    channel: event.channel,
    channelUserId: event.channelUserId,
    channelConversationId: event.channelConversationId,
    providerMessageId: event.eventId,
    userId: identity.user_id ?? undefined,
    correlationId,
    payload: event as unknown as Record<string, unknown>,
  });

  if (inbound.status === "processed") {
    return {
      ok: true,
      duplicate: true,
      inboundMessageId: inbound.id,
      correlationId,
      queuedOutbound: 0,
      linkedUserId: identity.user_id ?? null,
    };
  }

  await writeAuditEvent({
    actorUserId: identity.user_id ?? null,
    eventType: "channel.inbound.received",
    entityType: "channel_message",
    entityId: inbound.id,
    payload: {
      channel: event.channel,
      channelUserId: event.channelUserId,
      channelConversationId: event.channelConversationId,
      providerMessageId: event.eventId,
      signatureValidated: event.signatureValidated,
    },
  });

  let queuedOutbound = 0;

  if (!event.signatureValidated) {
    const outbound = makeOutboundMessage({
      channel: event.channel,
      correlationId,
      channelConversationId: event.channelConversationId,
      recipientId: event.channelUserId,
      idempotencyKey: `outbound-${event.eventId}-sig`,
      parts: [{ type: "text", text: "Webhook signature validation failed." }],
    });
    await enqueueOutboundChannelMessage({
      channel: outbound.channel,
      channelUserId: event.channelUserId,
      channelConversationId: event.channelConversationId,
      userId: identity.user_id ?? undefined,
      correlationId,
      idempotencyKey: outbound.idempotencyKey,
      payload: outbound as unknown as Record<string, unknown>,
    });
    queuedOutbound += 1;

    await markInboundChannelMessageProcessed({ channelMessageId: inbound.id });
    return {
      ok: true,
      duplicate: false,
      inboundMessageId: inbound.id,
      correlationId,
      queuedOutbound,
      linkedUserId: identity.user_id ?? null,
    };
  }

  if (!identity.user_id || identity.status === "unlinked") {
    const link = await createChannelLinkRequest({
      channel: event.channel,
      channelUserId: event.channelUserId,
      channelConversationId: event.channelConversationId,
      metadata: { inboundMessageId: inbound.id },
    });

    const outbound = makeOutboundMessage({
      channel: event.channel,
      correlationId,
      channelConversationId: event.channelConversationId,
      recipientId: event.channelUserId,
      idempotencyKey: `outbound-${event.eventId}-link`,
      parts: [
        {
          type: "text",
          text:
            "Link your account to continue.\n\nOpen this link: " +
            link.linkUrl +
            "\n\nAfter linking, send a full head-to-toe front-facing photo with feet visible.",
        },
        { type: "link", url: link.linkUrl, title: "Link account" },
      ],
    });
    await enqueueOutboundChannelMessage({
      channel: outbound.channel,
      channelUserId: event.channelUserId,
      channelConversationId: event.channelConversationId,
      userId: identity.user_id ?? undefined,
      correlationId,
      idempotencyKey: outbound.idempotencyKey,
      payload: outbound as unknown as Record<string, unknown>,
    });
    queuedOutbound += 1;

    await writeAuditEvent({
      actorUserId: null,
      eventType: "channel.identity.link_requested",
      entityType: "channel_identity",
      entityId: identity.id,
      payload: { channel: event.channel, linkUrl: link.linkUrl, tokenExpiresAt: link.expiresAt },
    });

    await markInboundChannelMessageProcessed({ channelMessageId: inbound.id });
    return {
      ok: true,
      duplicate: false,
      inboundMessageId: inbound.id,
      correlationId,
      queuedOutbound,
      linkedUserId: null,
    };
  }

  if (identity.status === "blocked") {
    const outbound = makeOutboundMessage({
      channel: event.channel,
      correlationId,
      channelConversationId: event.channelConversationId,
      recipientId: event.channelUserId,
      idempotencyKey: `outbound-${event.eventId}-blocked`,
      parts: [{ type: "text", text: "This account is blocked." }],
    });
    await enqueueOutboundChannelMessage({
      channel: outbound.channel,
      channelUserId: event.channelUserId,
      channelConversationId: event.channelConversationId,
      userId: identity.user_id,
      correlationId,
      idempotencyKey: outbound.idempotencyKey,
      payload: outbound as unknown as Record<string, unknown>,
    });
    queuedOutbound += 1;
    await markInboundChannelMessageProcessed({ channelMessageId: inbound.id });
    return {
      ok: true,
      duplicate: false,
      inboundMessageId: inbound.id,
      correlationId,
      queuedOutbound,
      linkedUserId: identity.user_id,
    };
  }

  const decision = routeChannelEvent(event);
  const responses: Array<{ content?: any[]; structuredContent?: any }> = [];

  for (const command of decision.commands) {
    const response = await executeRoutedToolCommand({
      userId: identity.user_id,
      event,
      command,
    });
    responses.push(response);
  }

  let parts: ChannelMessagePart[] = [];
  const outfitPlan = responses.find((r) => r.structuredContent?.type === "outfit_plan");
  if (outfitPlan) {
    const formatted = formatOutfitPlan(outfitPlan.structuredContent);
    if (formatted) parts = [{ type: "text", text: formatted }];
  }

  if (parts.length === 0) {
    const approval = responses.find((r) => r.structuredContent?.type === "approval");
    if (approval?.structuredContent?.url && typeof approval.structuredContent.url === "string") {
      const url = approval.structuredContent.url as string;
      parts = [
        { type: "text", text: "Approval link created." },
        { type: "link", url, title: "Approve order" },
      ];
      const stripeUrl =
        typeof approval.structuredContent.stripeCheckoutUrl === "string"
          ? (approval.structuredContent.stripeCheckoutUrl as string)
          : null;
      if (stripeUrl) {
        parts.push({ type: "link", url: stripeUrl, title: "Pay with Stripe" });
      }
    }
  }

  if (parts.length === 0 && decision.responseHint) {
    parts = [{ type: "text", text: decision.responseHint }];
  }

  if (parts.length === 0) {
    parts = toolResponsesToParts(responses);
  }

  const text = collectText(parts);
  const outbound = makeOutboundMessage({
    channel: event.channel,
    correlationId,
    channelConversationId: event.channelConversationId,
    recipientId: event.channelUserId,
    idempotencyKey: `outbound-${event.eventId}-reply`,
    parts,
    metadata: {
      intent: decision.intent.kind,
      inboundMessageId: inbound.id,
      responseTextPreview: text.slice(0, 140),
    },
  });

  await enqueueOutboundChannelMessage({
    channel: outbound.channel,
    channelUserId: event.channelUserId,
    channelConversationId: event.channelConversationId,
    userId: identity.user_id,
    correlationId,
    idempotencyKey: outbound.idempotencyKey,
    payload: outbound as unknown as Record<string, unknown>,
  });
  queuedOutbound += 1;

  await writeAuditEvent({
    actorUserId: identity.user_id,
    eventType: "channel.outbound.queued",
    entityType: "channel_message",
    entityId: outbound.messageId,
    payload: { channel: event.channel, idempotencyKey: outbound.idempotencyKey, intent: decision.intent.kind },
  });

  await markInboundChannelMessageProcessed({ channelMessageId: inbound.id });
  return {
    ok: true,
    duplicate: false,
    inboundMessageId: inbound.id,
    correlationId,
    queuedOutbound,
    linkedUserId: identity.user_id,
  };
}

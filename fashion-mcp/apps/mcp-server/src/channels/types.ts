import {
  ChannelInboundEventSchema,
  ChannelOutboundMessageSchema,
  type ChannelInboundEvent,
  type ChannelOutboundMessage,
  type ChannelType,
} from "@fashion/shared";

export type { ChannelInboundEvent, ChannelOutboundMessage, ChannelType };

export function parseChannelInboundEvent(input: unknown): ChannelInboundEvent {
  return ChannelInboundEventSchema.parse(input);
}

export function parseChannelOutboundMessage(input: unknown): ChannelOutboundMessage {
  return ChannelOutboundMessageSchema.parse(input);
}

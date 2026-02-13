import {
  BudgetGoalsSchema,
  CreateApprovalInputSchema,
  GenerateOutfitsSchema,
  IngestPhotosSchema,
  TryonRenderItemInputSchema,
  TryonRenderOutfitInputSchema,
} from "@fashion/shared";
import type { RoutedToolCommand } from "./router.js";
import type { ChannelInboundEvent } from "./types.js";
import { upsertBudgetAndGoalsDomain, ingestPhotosDomain } from "../domain/profile.js";
import { generateOutfitsDomain } from "../domain/planning.js";
import { renderItemOnUserDomain, renderOutfitOnUserDomain } from "../domain/tryon.js";
import { createApprovalLinkDomain } from "../domain/checkout.js";
import type { ToolLikeResponse } from "../domain/profile.js";

export async function executeRoutedToolCommand(input: {
  userId: string;
  event: ChannelInboundEvent;
  command: RoutedToolCommand;
}): Promise<ToolLikeResponse> {
  const toolName = input.command.toolName;
  const args = input.command.arguments ?? {};

  switch (toolName) {
    case "profile.upsertBudgetAndGoals": {
      const parsed = BudgetGoalsSchema.parse(args);
      return upsertBudgetAndGoalsDomain(input.userId, parsed);
    }
    case "profile.ingestPhotos": {
      const parsed = IngestPhotosSchema.parse(args);
      return ingestPhotosDomain(input.userId, parsed);
    }
    case "plan.generateOutfits": {
      const parsed = GenerateOutfitsSchema.parse(args);
      return generateOutfitsDomain(input.userId, parsed);
    }
    case "tryon.renderItemOnUser": {
      const parsed = TryonRenderItemInputSchema.parse(args);
      return renderItemOnUserDomain(input.userId, parsed, {
        channel: input.event.channel,
        channelUserId: input.event.channelUserId,
        channelConversationId: input.event.channelConversationId,
        requestMessageId: input.event.eventId,
      });
    }
    case "tryon.renderOutfitOnUser": {
      const parsed = TryonRenderOutfitInputSchema.parse(args);
      return renderOutfitOnUserDomain(input.userId, parsed, {
        channel: input.event.channel,
        channelUserId: input.event.channelUserId,
        channelConversationId: input.event.channelConversationId,
        requestMessageId: input.event.eventId,
      });
    }
    case "checkout.createApprovalLink": {
      const parsed = CreateApprovalInputSchema.parse(args);
      return createApprovalLinkDomain(input.userId, parsed);
    }
    default:
      return {
        content: [
          {
            type: "text",
            text: `Unsupported command: ${toolName}`,
          },
        ],
        structuredContent: { ok: false, reason: "unsupported_command", toolName },
      };
  }
}


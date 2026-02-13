import { randomUUID } from "node:crypto";
import type { ChannelInboundEvent } from "./types.js";
import { classifyChannelIntent, type ChannelIntent } from "./intents.js";

export type RoutedToolCommand = {
  toolName: string;
  arguments: Record<string, unknown>;
};

export type RouteDecision = {
  intent: ChannelIntent;
  correlationId: string;
  commands: RoutedToolCommand[];
  responseHint?: string;
};

export function routeChannelEvent(event: ChannelInboundEvent): RouteDecision {
  const intent = classifyChannelIntent(event);
  const correlationId = randomUUID();

  switch (intent.kind) {
    case "set_budget":
      return {
        intent,
        correlationId,
        commands: [
          {
            toolName: "profile.upsertBudgetAndGoals",
            arguments: {
              monthlyBudget: intent.monthlyBudget,
              goals: ["channel_budget_update"],
              styleTags: [],
            },
          },
        ],
      };

    case "upload_photo": {
      const media = event.media ?? [];
      if (media.length === 0) {
        return {
          intent,
          correlationId,
          commands: [],
          responseHint: "Please attach a full head-to-toe front-facing photo.",
        };
      }

      const photoUrls = media.map((m) => m.remoteUrl).filter((u): u is string => Boolean(u));
      return {
        intent,
        correlationId,
        commands: [
          {
            toolName: "profile.ingestPhotos",
            arguments: {
              fileIds: media.map((m) => m.mediaId),
              photoUrls: photoUrls.length === media.length ? photoUrls : undefined,
              consentGranted: true,
              source: "import",
            },
          },
        ],
      };
    }

    case "show_outfits":
      return {
        intent,
        correlationId,
        commands: [
          {
            toolName: "plan.generateOutfits",
            arguments: {
              outfitCount: 4,
              includeItemIds: [],
            },
          },
        ],
      };

    case "tryon":
      if (!intent.itemId) {
        return {
          intent,
          correlationId,
          commands: [],
          responseHint: "Please specify an item id (for example: try on prod_001).",
        };
      }
      return {
        intent,
        correlationId,
        commands: [
          {
            toolName: "tryon.renderItemOnUser",
            arguments: {
              itemId: intent.itemId,
              photoSetId: "latest",
              idempotencyKey: `channel-tryon-${event.eventId}`,
            },
          },
        ],
      };

    case "checkout": {
      const fromText = intent.kind === "checkout" && Array.isArray(intent.itemIds) ? intent.itemIds : [];
      const fromMetadata = Array.isArray((event.metadata as any)?.selectedItemIds)
        ? (event.metadata as any).selectedItemIds.filter((v: unknown) => typeof v === "string")
        : [];

      const selectedItemIds = [...fromText, ...fromMetadata].filter((v, i, a) => a.indexOf(v) === i);

      if (selectedItemIds.length === 0) {
        return {
          intent,
          correlationId,
          commands: [],
          responseHint: "Please choose one or more item ids before checkout.",
        };
      }

      return {
        intent,
        correlationId,
        commands: [
          {
            toolName: "checkout.createApprovalLink",
            arguments: {
              itemIds: selectedItemIds,
              notes: `channel:${event.channel}`,
            },
          },
        ],
      };
    }

    case "unknown":
    default:
      return {
        intent,
        correlationId,
        commands: [],
        responseHint: "I can help with budget, photos, outfit planning, try-on, and checkout.",
      };
  }
}

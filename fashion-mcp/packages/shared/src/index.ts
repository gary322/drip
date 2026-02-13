import { z } from "zod";

/**
 * Core shared types and schemas used by tools.
 * Keep this package small: only stable contracts.
 */

export const MoneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(3).default("USD")
});
export type Money = z.infer<typeof MoneySchema>;

export const ViewportSchema = z.object({
  xmin: z.number(),
  xmax: z.number(),
  ymin: z.number(),
  ymax: z.number(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

export const StyleMapFiltersSchema = z.object({
  category: z.array(z.string()).optional(),
  maxPrice: z.number().optional(),
  brand: z.array(z.string()).optional(),
  minPrice: z.number().optional(),
});
export type StyleMapFilters = z.infer<typeof StyleMapFiltersSchema>;

export const StyleMapViewportInputSchema = z.object({
  viewport: ViewportSchema,
  zoom: z.number().int().min(0).max(20).default(2),
  filters: StyleMapFiltersSchema.optional(),
  limit: z.number().int().min(1).max(500).default(120),
});

export type StyleMapViewportInput = z.infer<typeof StyleMapViewportInputSchema>;

export const CatalogSearchInputSchema = z.object({
  q: z.string().optional(),
  filters: StyleMapFiltersSchema.optional(),
  limit: z.number().int().min(1).max(200).default(40),
});
export type CatalogSearchInput = z.infer<typeof CatalogSearchInputSchema>;

export const CatalogGetItemInputSchema = z.object({
  itemId: z.string().min(1),
});
export type CatalogGetItemInput = z.infer<typeof CatalogGetItemInputSchema>;

export const StyleMapClustersInputSchema = z.object({
  viewport: ViewportSchema.optional(),
  zoom: z.number().int().min(0).max(20).default(2),
  filters: StyleMapFiltersSchema.optional(),
});
export type StyleMapClustersInput = z.infer<typeof StyleMapClustersInputSchema>;

export const StyleMapNeighborsInputSchema = z.object({
  itemId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(12),
});
export type StyleMapNeighborsInput = z.infer<typeof StyleMapNeighborsInputSchema>;

export const RateItemInputSchema = z.object({
  itemId: z.string().min(1),
  rating: z.number().int().min(-1).max(1), // -1 dislike, 0 neutral, +1 like
});
export type RateItemInput = z.infer<typeof RateItemInputSchema>;

export const BudgetGoalsSchema = z.object({
  monthlyBudget: z.number().nonnegative(),
  goals: z.array(z.string()).default([]),
  styleTags: z.array(z.string()).default([]),
});
export type BudgetGoals = z.infer<typeof BudgetGoalsSchema>;

export const UpsertSizesSchema = z.object({
  sizes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
});
export type UpsertSizesInput = z.infer<typeof UpsertSizesSchema>;

export const IngestPhotosSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(20),
  photoUrls: z.array(z.string().url()).max(20).optional(),
  consentGranted: z.boolean(),
  source: z.enum(["chatgpt_upload", "import"]).default("chatgpt_upload"),
}).superRefine((input, ctx) => {
  if (input.photoUrls && input.photoUrls.length > 0 && input.photoUrls.length !== input.fileIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "photoUrls must match fileIds length when provided",
      path: ["photoUrls"],
    });
  }
});
export type IngestPhotosInput = z.infer<typeof IngestPhotosSchema>;

export const DeletePhotosSchema = z.object({
  photoSetId: z.string().min(1),
});
export type DeletePhotosInput = z.infer<typeof DeletePhotosSchema>;

export const GenerateCapsuleSchema = z.object({
  month: z.string().min(7),
  budget: z.number().nonnegative().optional(),
  outfitCount: z.number().int().min(1).max(30).default(8),
});
export type GenerateCapsuleInput = z.infer<typeof GenerateCapsuleSchema>;

export const GenerateOutfitsSchema = z.object({
  budget: z.number().nonnegative().optional(),
  outfitCount: z.number().int().min(1).max(20).default(6),
  includeItemIds: z.array(z.string()).default([]),
});
export type GenerateOutfitsInput = z.infer<typeof GenerateOutfitsSchema>;

export const SwapItemInOutfitSchema = z.object({
  outfitId: z.string().min(1),
  removeItemId: z.string().min(1),
  replacementCategory: z.string().optional(),
});
export type SwapItemInOutfitInput = z.infer<typeof SwapItemInOutfitSchema>;

export const TryonRenderItemInputSchema = z.object({
  itemId: z.string().min(1),
  photoSetId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(120).optional(),
});
export type TryonRenderItemInput = z.infer<typeof TryonRenderItemInputSchema>;

export const TryonRenderOutfitInputSchema = z.object({
  outfitId: z.string().min(1),
  photoSetId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(120).optional(),
});
export type TryonRenderOutfitInput = z.infer<typeof TryonRenderOutfitInputSchema>;

export const TryonJobStatusInputSchema = z.object({
  jobId: z.string().uuid(),
});
export type TryonJobStatusInput = z.infer<typeof TryonJobStatusInputSchema>;

export const CreateApprovalInputSchema = z.object({
  itemIds: z.array(z.string()).min(1),
  notes: z.string().optional(),
  allowOverBudget: z.boolean().default(false),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});
export type CreateApprovalInput = z.infer<typeof CreateApprovalInputSchema>;

export const ApprovalStatusInputSchema = z.object({
  token: z.string().min(1),
});
export type ApprovalStatusInput = z.infer<typeof ApprovalStatusInputSchema>;

export type UserContext = {
  userId: string;
  scopes: string[];
};

export const ChannelTypeSchema = z.enum(["chatgpt", "imessage", "whatsapp", "telegram"]);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const ChannelDirectionSchema = z.enum(["inbound", "outbound"]);
export type ChannelDirection = z.infer<typeof ChannelDirectionSchema>;

export const ChannelMessagePartSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("image"),
    imageUrl: z.string().url(),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("link"),
    url: z.string().url(),
    title: z.string().optional(),
  }),
]);
export type ChannelMessagePart = z.infer<typeof ChannelMessagePartSchema>;

export const ChannelInboundEventSchema = z.object({
  eventId: z.string().min(1),
  channel: ChannelTypeSchema,
  channelUserId: z.string().min(1),
  channelConversationId: z.string().min(1),
  receivedAt: z.string().datetime({ offset: true }),
  text: z.string().optional(),
  media: z
    .array(
      z.object({
        mediaId: z.string().min(1),
        mimeType: z.string().min(1),
        remoteUrl: z.string().url().optional(),
        caption: z.string().optional(),
      })
    )
    .default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  signatureValidated: z.boolean(),
});
export type ChannelInboundEvent = z.infer<typeof ChannelInboundEventSchema>;

export const ChannelOutboundMessageSchema = z.object({
  messageId: z.string().min(1),
  correlationId: z.string().min(1),
  channel: ChannelTypeSchema,
  channelConversationId: z.string().min(1),
  recipientId: z.string().min(1),
  parts: z.array(ChannelMessagePartSchema).min(1),
  idempotencyKey: z.string().min(8).max(120),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ChannelOutboundMessage = z.infer<typeof ChannelOutboundMessageSchema>;

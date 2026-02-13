import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  BudgetGoalsSchema,
  DeletePhotosSchema,
  IngestPhotosSchema,
  UpsertSizesSchema,
} from "@fashion/shared";
import { requireToolScopes } from "../../auth/authz.js";
import { getCurrentUserId } from "./shared.js";
import {
  deletePhotosDomain,
  getProfileDomain,
  ingestPhotosDomain,
  setAddressDomain,
  upsertBudgetAndGoalsDomain,
  upsertSizesDomain,
} from "../../domain/profile.js";

const registerTool = registerAppTool as any;

export function registerProfileTools(server: McpServer): void {
  const SetAddressInputSchema = {
    address: z.object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      postalCode: z.string().min(1),
      country: z.string().min(2).max(2).default("US"),
    }),
  } as const;

  const SetAddressSchema = z.object({
    address: z.object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      postalCode: z.string().min(1),
      country: z.string().min(2).max(2).default("US"),
    }),
  });

  registerTool(
    server,
    "profile.get",
    {
      title: "Get profile",
      description: "Returns the user's budget, goals, style tags, sizes, and default address.",
      inputSchema: {},
      _meta: { ui: { visibility: "hidden" } },
    },
    async () => {
      requireToolScopes(["profile:read"]);
      return getProfileDomain(getCurrentUserId());
    }
  );

  registerTool(
    server,
    "profile.upsertBudgetAndGoals",
    {
      title: "Set budget and goals",
      description: "Sets monthly budget (USD) and styling goals/tags for personalization.",
      inputSchema: BudgetGoalsSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["profile:write"]);
      const input = BudgetGoalsSchema.parse(args ?? {});
      return upsertBudgetAndGoalsDomain(getCurrentUserId(), input);
    }
  );

  registerTool(
    server,
    "profile.upsertSizes",
    {
      title: "Set profile sizes",
      description: "Stores user sizes and fit preferences for recommendation constraints.",
      inputSchema: UpsertSizesSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["profile:write"]);
      const input = UpsertSizesSchema.parse(args ?? {});
      return upsertSizesDomain(getCurrentUserId(), input);
    }
  );

  registerTool(
    server,
    "profile.ingestPhotos",
    {
      title: "Ingest user photos",
      description: "Stores uploaded file references as a new photo set for try-on.",
      inputSchema: IngestPhotosSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["photos:write"]);
      const input = IngestPhotosSchema.parse(args ?? {});
      return ingestPhotosDomain(getCurrentUserId(), input);
    }
  );

  registerTool(
    server,
    "profile.deletePhotos",
    {
      title: "Delete user photos",
      description: "Soft-deletes a photo set and associated photos for compliance.",
      inputSchema: DeletePhotosSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["photos:write"]);
      const input = DeletePhotosSchema.parse(args ?? {});
      return deletePhotosDomain(getCurrentUserId(), input);
    }
  );

  registerTool(
    server,
    "profile.setAddress",
    {
      title: "Set default address",
      description: "Stores a default shipping address for approval summaries.",
      inputSchema: SetAddressInputSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["profile:write"]);
      const input = SetAddressSchema.parse(args ?? {});
      return setAddressDomain(getCurrentUserId(), input.address);
    }
  );
}

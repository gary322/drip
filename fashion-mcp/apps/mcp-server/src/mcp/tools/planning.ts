import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GenerateCapsuleSchema,
  GenerateOutfitsSchema,
  SwapItemInOutfitSchema,
} from "@fashion/shared";
import { requireToolScopes } from "../../auth/authz.js";
import { getCurrentUserId, STYLE_MAP_RESOURCE_URI } from "./shared.js";
import {
  generateCapsuleDomain,
  generateOutfitsDomain,
  swapItemInOutfitDomain,
} from "../../domain/planning.js";

const registerTool = registerAppTool as any;

export function registerPlanningTools(server: McpServer): void {
  registerTool(
    server,
    "plan.generateCapsule",
    {
      title: "Generate a capsule plan",
      description: "Creates a monthly capsule plan within the user's budget.",
      inputSchema: GenerateCapsuleSchema as any,
      _meta: { ui: { resourceUri: STYLE_MAP_RESOURCE_URI } },
    },
    async (args: unknown) => {
      requireToolScopes(["plans:write", "catalog:read"]);
      const input = GenerateCapsuleSchema.parse(args ?? {});
      return generateCapsuleDomain(getCurrentUserId(), input);
    }
  );

  registerTool(
    server,
    "plan.generateOutfits",
    {
      title: "Generate outfits",
      description: "Generates outfit combinations under optional budget constraints.",
      inputSchema: GenerateOutfitsSchema as any,
      _meta: { ui: { resourceUri: STYLE_MAP_RESOURCE_URI } },
    },
    async (args: unknown) => {
      requireToolScopes(["plans:write", "catalog:read"]);
      const input = GenerateOutfitsSchema.parse(args ?? {});
      return generateOutfitsDomain(getCurrentUserId(), input);
    }
  );

  registerTool(
    server,
    "plan.swapItemInOutfit",
    {
      title: "Swap item in outfit",
      description: "Replaces an item in an outfit with a nearby style alternative.",
      inputSchema: SwapItemInOutfitSchema as any,
      _meta: { ui: { resourceUri: STYLE_MAP_RESOURCE_URI } },
    },
    async (args: unknown) => {
      requireToolScopes(["plans:write", "catalog:read"]);
      const input = SwapItemInOutfitSchema.parse(args ?? {});
      return swapItemInOutfitDomain(getCurrentUserId(), input);
    }
  );
}

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CatalogGetItemInputSchema,
  CatalogSearchInputSchema,
} from "@fashion/shared";
import { requireToolScopes } from "../../auth/authz.js";
import { ensureUser } from "../../db/repos/profileRepo.js";
import { getCurrentUserId, mapProductToStyleItem } from "./shared.js";
import { getProductById, searchProducts } from "../../db/repos/catalogRepo.js";

const registerTool = registerAppTool as any;

export function registerCatalogTools(server: McpServer): void {
  registerTool(
    server,
    "catalog.search",
    {
      title: "Search catalog",
      description: "Searches products by text and filter criteria.",
      inputSchema: CatalogSearchInputSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["catalog:read"]);
      const userId = getCurrentUserId();
      await ensureUser(userId);
      const input = CatalogSearchInputSchema.parse(args ?? {});

      const rows = await searchProducts({
        q: input.q,
        filters: input.filters,
        limit: input.limit,
      });
      const items = rows.map(mapProductToStyleItem);

      return {
        content: [],
        structuredContent: { type: "catalog_search", total: items.length, items },
      };
    }
  );

  registerTool(
    server,
    "catalog.getItem",
    {
      title: "Get catalog item",
      description: "Returns one catalog item by id.",
      inputSchema: CatalogGetItemInputSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["catalog:read"]);
      const userId = getCurrentUserId();
      await ensureUser(userId);
      const input = CatalogGetItemInputSchema.parse(args ?? {});
      const item = await getProductById(input.itemId);

      if (!item) {
        return {
          content: [{ type: "text", text: "Item not found." }],
          structuredContent: { found: false },
        };
      }

      return {
        content: [],
        structuredContent: { found: true, item: mapProductToStyleItem(item) },
      };
    }
  );
}

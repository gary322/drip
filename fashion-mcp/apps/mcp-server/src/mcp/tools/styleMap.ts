import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StyleMapClustersInputSchema,
  StyleMapNeighborsInputSchema,
  StyleMapViewportInputSchema,
} from "@fashion/shared";
import { requireToolScopes } from "../../auth/authz.js";
import { getCurrentUserId, mapProductToStyleItem, STYLE_MAP_RESOURCE_URI } from "./shared.js";
import { ensureUser } from "../../db/repos/profileRepo.js";
import {
  getNeighbors,
  getViewportClusters,
  getViewportProducts,
} from "../../db/repos/catalogRepo.js";

const registerTool = registerAppTool as any;

export function registerStyleMapTools(server: McpServer): void {
  registerTool(
    server,
    "styleMap.getViewportItems",
    {
      title: "Get items for style map viewport",
      description: "Returns products for a 2D style viewport.",
      inputSchema: StyleMapViewportInputSchema as any,
      _meta: { ui: { resourceUri: STYLE_MAP_RESOURCE_URI } },
    },
    async (args: unknown) => {
      requireToolScopes(["stylemap:read", "catalog:read"]);
      const userId = getCurrentUserId();
      await ensureUser(userId);
      const input = StyleMapViewportInputSchema.parse(args ?? {});

      const rows = await getViewportProducts({
        viewport: input.viewport,
        filters: input.filters,
        limit: input.limit,
      });
      const items = rows.map(mapProductToStyleItem);
      const clusters = await getViewportClusters({
        viewport: input.viewport,
        filters: input.filters,
      });

      return {
        content: [],
        structuredContent: {
          type: "style_map",
          viewport: input.viewport,
          zoom: input.zoom,
          filters: input.filters ?? {},
          items,
          clusters,
        },
      };
    }
  );

  registerTool(
    server,
    "styleMap.getClusters",
    {
      title: "Get style map clusters",
      description: "Returns style map cluster centroids and counts.",
      inputSchema: StyleMapClustersInputSchema as any,
      _meta: { ui: { resourceUri: STYLE_MAP_RESOURCE_URI } },
    },
    async (args: unknown) => {
      requireToolScopes(["stylemap:read", "catalog:read"]);
      const userId = getCurrentUserId();
      await ensureUser(userId);
      const input = StyleMapClustersInputSchema.parse(args ?? {});
      const clusters = await getViewportClusters({
        viewport: input.viewport,
        filters: input.filters,
      });
      return {
        content: [],
        structuredContent: { type: "style_map_clusters", clusters, zoom: input.zoom },
      };
    }
  );

  registerTool(
    server,
    "styleMap.getItemNeighbors",
    {
      title: "Get nearby style neighbors",
      description: "Returns nearest style neighbors for an item in map space.",
      inputSchema: StyleMapNeighborsInputSchema as any,
      _meta: { ui: { resourceUri: STYLE_MAP_RESOURCE_URI } },
    },
    async (args: unknown) => {
      requireToolScopes(["stylemap:read", "catalog:read"]);
      const userId = getCurrentUserId();
      await ensureUser(userId);
      const input = StyleMapNeighborsInputSchema.parse(args ?? {});
      const rows = await getNeighbors(input.itemId, input.limit);
      return {
        content: [],
        structuredContent: {
          type: "style_map_neighbors",
          itemId: input.itemId,
          neighbors: rows.map(mapProductToStyleItem),
        },
      };
    }
  );
}

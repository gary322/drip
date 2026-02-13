import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  TryonJobStatusInputSchema,
  TryonRenderItemInputSchema,
  TryonRenderOutfitInputSchema,
} from "@fashion/shared";
import { requireToolScopes } from "../../auth/authz.js";
import { getCurrentUserId, STYLE_MAP_RESOURCE_URI } from "./shared.js";
import {
  getIdempotentResponse,
  saveIdempotentResponse,
} from "../../db/repos/idempotencyRepo.js";
import {
  getJobStatusDomain,
  renderItemOnUserDomain,
  renderOutfitOnUserDomain,
} from "../../domain/tryon.js";

const registerTool = registerAppTool as any;

export function registerTryonTools(server: McpServer): void {
  registerTool(
    server,
    "tryon.renderItemOnUser",
    {
      title: "Render item try-on",
      description: "Creates an async try-on job for a single item.",
      inputSchema: TryonRenderItemInputSchema as any,
      _meta: { ui: { resourceUri: STYLE_MAP_RESOURCE_URI } },
    },
    async (args: unknown) => {
      requireToolScopes(["tryon:write", "photos:write"]);
      const input = TryonRenderItemInputSchema.parse(args ?? {});
      const userId = getCurrentUserId();
      const operation = "tryon.renderItemOnUser";

      if (input.idempotencyKey) {
        const prior = await getIdempotentResponse({
          userId,
          operation,
          idempotencyKey: input.idempotencyKey,
          payload: input,
        });
        if (prior.hit) {
          return prior.response as any;
        }
      }

      const response = await renderItemOnUserDomain(userId, input);
      if (input.idempotencyKey) {
        await saveIdempotentResponse({
          userId,
          operation,
          idempotencyKey: input.idempotencyKey,
          payload: input,
          response: response as unknown as Record<string, unknown>,
        });
      }
      return response;
    }
  );

  registerTool(
    server,
    "tryon.renderOutfitOnUser",
    {
      title: "Render outfit try-on",
      description: "Creates an async try-on job for an outfit.",
      inputSchema: TryonRenderOutfitInputSchema as any,
      _meta: { ui: { resourceUri: STYLE_MAP_RESOURCE_URI } },
    },
    async (args: unknown) => {
      requireToolScopes(["tryon:write", "photos:write"]);
      const input = TryonRenderOutfitInputSchema.parse(args ?? {});
      const userId = getCurrentUserId();
      const operation = "tryon.renderOutfitOnUser";

      if (input.idempotencyKey) {
        const prior = await getIdempotentResponse({
          userId,
          operation,
          idempotencyKey: input.idempotencyKey,
          payload: input,
        });
        if (prior.hit) {
          return prior.response as any;
        }
      }

      const response = await renderOutfitOnUserDomain(userId, input);
      if (input.idempotencyKey) {
        await saveIdempotentResponse({
          userId,
          operation,
          idempotencyKey: input.idempotencyKey,
          payload: input,
          response: response as unknown as Record<string, unknown>,
        });
      }
      return response;
    }
  );

  registerTool(
    server,
    "tryon.getJobStatus",
    {
      title: "Get try-on status",
      description: "Returns status and result URLs for a try-on job.",
      inputSchema: TryonJobStatusInputSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["tryon:read"]);
      const input = TryonJobStatusInputSchema.parse(args ?? {});
      const userId = getCurrentUserId();
      return getJobStatusDomain(userId, input);
    }
  );
}

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RateItemInputSchema } from "@fashion/shared";
import { requireToolScopes } from "../../auth/authz.js";
import { addItemRating } from "../../db/repos/feedbackRepo.js";
import { ensureUser } from "../../db/repos/profileRepo.js";
import { writeAuditEvent } from "../../db/repos/auditRepo.js";
import { getCurrentUserId, STYLE_MAP_RESOURCE_URI } from "./shared.js";

const registerTool = registerAppTool as any;

export function registerFeedbackTools(server: McpServer): void {
  registerTool(
    server,
    "feedback.rateItem",
    {
      title: "Rate an item",
      description: "Stores a like/dislike rating for a product.",
      inputSchema: RateItemInputSchema as any,
      _meta: { ui: { resourceUri: STYLE_MAP_RESOURCE_URI } },
    },
    async (args: unknown) => {
      requireToolScopes(["feedback:write"]);
      const input = RateItemInputSchema.parse(args ?? {});
      const userId = getCurrentUserId();
      await ensureUser(userId);

      await addItemRating({
        userId,
        itemId: input.itemId,
        rating: input.rating,
      });
      await writeAuditEvent({
        actorUserId: userId,
        eventType: "feedback.item.rated",
        entityType: "item",
        entityId: input.itemId,
        payload: { rating: input.rating },
      });

      return {
        content: [{ type: "text", text: `Saved rating for ${input.itemId}.` }],
        structuredContent: { ok: true },
      };
    }
  );
}

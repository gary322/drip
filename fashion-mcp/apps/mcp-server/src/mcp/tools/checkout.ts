import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApprovalStatusInputSchema, CreateApprovalInputSchema } from "@fashion/shared";
import { requireToolScopes } from "../../auth/authz.js";
import { ensureUser } from "../../db/repos/profileRepo.js";
import { getCurrentUserId } from "./shared.js";
import { getPool } from "../../db/pool.js";
import { createApprovalLinkDomain } from "../../domain/checkout.js";

const registerTool = registerAppTool as any;

export function registerCheckoutTools(server: McpServer): void {
  registerTool(
    server,
    "checkout.createApprovalLink",
    {
      title: "Create approval link",
      description: "Creates a short-lived approval link and optional Stripe checkout session.",
      inputSchema: CreateApprovalInputSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["orders:write", "catalog:read"]);
      const userId = getCurrentUserId();
      const input = CreateApprovalInputSchema.parse(args ?? {});
      return createApprovalLinkDomain(userId, input);
    }
  );

  registerTool(
    server,
    "orders.getApprovalStatus",
    {
      title: "Get approval status",
      description: "Checks whether an approval link was approved, declined, pending, or expired.",
      inputSchema: ApprovalStatusInputSchema as any,
      _meta: { ui: { visibility: "hidden" } },
    },
    async (args: unknown) => {
      requireToolScopes(["orders:write"]);
      const userId = getCurrentUserId();
      await ensureUser(userId);
      const input = ApprovalStatusInputSchema.parse(args ?? {});

      const pool = getPool();
      const { rows } = await pool.query(
        "SELECT status, expires_at FROM approvals WHERE token=$1 AND user_id=$2",
        [input.token, userId]
      );
      const approval = rows[0];
      if (!approval) {
        return {
          content: [{ type: "text", text: "Approval not found." }],
          structuredContent: { found: false },
        };
      }

      const expired = new Date(approval.expires_at) < new Date();
      const status = expired && approval.status === "pending" ? "expired" : approval.status;

      return {
        content: [],
        structuredContent: { found: true, status },
      };
    }
  );
}

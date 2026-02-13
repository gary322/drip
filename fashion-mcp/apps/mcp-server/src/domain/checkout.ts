import type { CreateApprovalInput } from "@fashion/shared";
import { getPool } from "../db/pool.js";
import { ensureUser, getProfile } from "../db/repos/profileRepo.js";
import { createApproval } from "../routes/approval.js";
import { writeAuditEvent } from "../db/repos/auditRepo.js";
import {
  getIdempotentResponse,
  saveIdempotentResponse,
} from "../db/repos/idempotencyRepo.js";
import { getConfig } from "../config.js";
import { createStripeCheckoutSession } from "../checkout/stripe.js";
import type { ToolLikeResponse } from "./profile.js";

export async function createApprovalLinkDomain(
  userId: string,
  input: CreateApprovalInput
): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  const pool = getPool();
  const cfg = getConfig();
  const operation = "checkout.createApprovalLink";

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

  const { rows } = await pool.query("SELECT * FROM products WHERE id = ANY($1)", [input.itemIds]);
  const byId = new Map<string, any>((rows as any[]).map((row) => [row.id as string, row]));
  const missingItemIds = input.itemIds.filter((id) => !byId.has(id));
  if (missingItemIds.length > 0) {
    return {
      content: [
        { type: "text", text: `Some items were not found: ${missingItemIds.join(", ")}` },
      ],
      structuredContent: { ok: false, reason: "item_not_found", missingItemIds },
    };
  }

  const items = input.itemIds.map((itemId) => {
    const p = byId.get(itemId)!;
    return {
      id: p.id,
      title: p.title,
      brand: p.brand,
      priceCents: p.price_cents,
      currency: p.currency,
      imageUrl: p.image_url,
      retailerUrl: p.retailer_url,
    };
  });

  const totalCents = items.reduce((sum, item) => sum + item.priceCents, 0);
  const profile = await getProfile(userId);
  const monthlyBudgetCents = profile?.monthly_budget_cents ?? 0;
  const hasBudget = monthlyBudgetCents > 0;
  const withinBudget = !hasBudget || totalCents <= monthlyBudgetCents;
  const overageCents = hasBudget ? Math.max(0, totalCents - monthlyBudgetCents) : 0;

  if (cfg.CHECKOUT_ENFORCE_BUDGET && !withinBudget && !input.allowOverBudget) {
    return {
      content: [
        {
          type: "text",
          text: `Order is over budget by $${(overageCents / 100).toFixed(2)}. Set allowOverBudget=true to continue.`,
        },
      ],
      structuredContent: {
        ok: false,
        reason: "budget_exceeded",
        totalCents,
        monthlyBudgetCents,
        overageCents,
        allowOverBudget: false,
      },
    };
  }

  const { token, url } = await createApproval(userId, {
    type: cfg.CHECKOUT_PROVIDER === "stripe" ? "stripe_checkout" : "deep_link_checkout",
    notes: input.notes ?? "",
    items,
    totalCents,
    monthlyBudgetCents,
    withinBudget,
    overageCents,
  });

  let stripeSession:
    | {
        sessionId: string;
        url: string;
      }
    | null = null;

  if (cfg.CHECKOUT_PROVIDER === "stripe") {
    stripeSession = await createStripeCheckoutSession({
      userId,
      approvalToken: token,
      items,
      notes: input.notes,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
    await pool.query("UPDATE approvals SET payload = payload || $2::jsonb WHERE token=$1", [
      token,
      JSON.stringify({
        stripeCheckoutSessionId: stripeSession.sessionId,
        stripeCheckoutUrl: stripeSession.url,
      }),
    ]);
  }

  await writeAuditEvent({
    actorUserId: userId,
    eventType: "checkout.approval.created",
    entityType: "approval",
    entityId: token,
    payload: {
      itemCount: items.length,
      totalCents,
      monthlyBudgetCents,
      withinBudget,
      checkoutProvider: cfg.CHECKOUT_PROVIDER,
      stripeCheckoutSessionId: stripeSession?.sessionId ?? null,
    },
  });

  const responseText =
    cfg.CHECKOUT_PROVIDER === "stripe" && stripeSession
      ? `Approval link created: ${url}. Stripe checkout: ${stripeSession.url}`
      : `Approval link created: ${url}`;
  const response: ToolLikeResponse = {
    content: [{ type: "text", text: responseText }],
    structuredContent: {
      type: "approval",
      token,
      url,
      checkoutProvider: cfg.CHECKOUT_PROVIDER,
      deepLinkOnly: cfg.CHECKOUT_PROVIDER !== "stripe",
      stripeCheckoutUrl: stripeSession?.url ?? null,
      stripeCheckoutSessionId: stripeSession?.sessionId ?? null,
      totalCents,
      monthlyBudgetCents,
      withinBudget,
      overageCents,
      allowOverBudget: input.allowOverBudget,
    },
  };

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

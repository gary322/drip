import type { GenerateCapsuleInput, GenerateOutfitsInput, SwapItemInOutfitInput } from "@fashion/shared";
import { ensureUser, getProfile } from "../db/repos/profileRepo.js";
import { pickProductsUnderBudget, saveCapsulePlan } from "../db/repos/planningRepo.js";
import { getNeighbors, getProductById } from "../db/repos/catalogRepo.js";
import { writeAuditEvent } from "../db/repos/auditRepo.js";
import { mapProductToStyleItem } from "../mcp/tools/shared.js";
import type { ToolLikeResponse } from "./profile.js";

function buildOutfits(
  items: Array<{ id: string }>,
  outfitCount: number
): Array<{ id: string; title: string; itemIds: string[] }> {
  const base = items.map((item) => item.id);
  const chunk = base.length >= 3 ? 3 : Math.max(1, base.length);
  return Array.from({ length: outfitCount }, (_, i) => ({
    id: `outfit_${i + 1}`,
    title: `Outfit ${i + 1}`,
    itemIds: base.slice(0, chunk),
  }));
}

export async function generateCapsuleDomain(
  userId: string,
  input: GenerateCapsuleInput
): Promise<ToolLikeResponse> {
  await ensureUser(userId);
  const profile = await getProfile(userId);
  const budgetCents = Math.round(
    (input.budget ?? (profile?.monthly_budget_cents ?? 0) / 100) * 100
  );
  const products = await pickProductsUnderBudget(budgetCents, 30);
  const outfits = buildOutfits(products, input.outfitCount);
  const items = products.map(mapProductToStyleItem);
  const totalCents = products.reduce((sum, p) => sum + p.price_cents, 0);

  const plan = {
    month: input.month,
    budgetCents,
    totalCents,
    items,
    outfits,
  };

  await saveCapsulePlan({
    userId,
    month: input.month,
    budgetCents,
    plan,
  });
  await writeAuditEvent({
    actorUserId: userId,
    eventType: "plan.capsule.generated",
    entityType: "capsule_plan",
    entityId: `${userId}:${input.month}`,
    payload: { itemCount: items.length, outfitCount: outfits.length, budgetCents },
  });

  return {
    content: [{ type: "text", text: `Generated a capsule plan for ${input.month}.` }],
    structuredContent: { type: "capsule_plan", plan },
  };
}

export async function generateOutfitsDomain(
  userId: string,
  input: GenerateOutfitsInput
): Promise<ToolLikeResponse> {
  await ensureUser(userId);

  const budgetCents = Math.round((input.budget ?? 250) * 100);
  const products = await pickProductsUnderBudget(budgetCents, 20);
  const forced = [];
  for (const itemId of input.includeItemIds) {
    const item = await getProductById(itemId);
    if (item) forced.push(item);
  }
  const merged = [...forced, ...products].slice(0, 20);
  const outfits = buildOutfits(merged, input.outfitCount);
  const totalCents = merged.reduce((sum, p) => sum + p.price_cents, 0);

  await writeAuditEvent({
    actorUserId: userId,
    eventType: "plan.outfits.generated",
    entityType: "outfit_plan",
    entityId: userId,
    payload: { outfitCount: outfits.length },
  });

  return {
    content: [{ type: "text", text: `Generated ${outfits.length} outfit options.` }],
    structuredContent: {
      type: "outfit_plan",
      outfits,
      items: merged.map(mapProductToStyleItem),
      totalCents,
    },
  };
}

export async function swapItemInOutfitDomain(
  userId: string,
  input: SwapItemInOutfitInput
): Promise<ToolLikeResponse> {
  await ensureUser(userId);

  const candidates = await getNeighbors(input.removeItemId, 20);
  const replacement = input.replacementCategory
    ? candidates.find((c) => c.category === input.replacementCategory)
    : candidates[0];

  if (!replacement) {
    return {
      content: [{ type: "text", text: "No replacement candidates found." }],
      structuredContent: { ok: false, reason: "no_candidate" },
    };
  }

  await writeAuditEvent({
    actorUserId: userId,
    eventType: "plan.outfit.item_swapped",
    entityType: "outfit",
    entityId: input.outfitId,
    payload: { removeItemId: input.removeItemId, replacementItemId: replacement.id },
  });

  return {
    content: [{ type: "text", text: "Suggested a replacement item." }],
    structuredContent: {
      ok: true,
      outfitId: input.outfitId,
      removeItemId: input.removeItemId,
      replacement: mapProductToStyleItem(replacement),
    },
  };
}


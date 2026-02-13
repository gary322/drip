import { getPool } from "../pool.js";
import type { ProductRow } from "./catalogRepo.js";

export async function pickProductsUnderBudget(budgetCents: number, limit = 20): Promise<ProductRow[]> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM products ORDER BY price_cents ASC LIMIT $1", [limit]);
  const selected: ProductRow[] = [];
  let total = 0;
  for (const row of rows as ProductRow[]) {
    if (total + row.price_cents > budgetCents) continue;
    selected.push(row);
    total += row.price_cents;
  }
  return selected;
}

export async function saveCapsulePlan(input: {
  userId: string;
  month: string;
  budgetCents: number;
  plan: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    "INSERT INTO capsule_plans(user_id, month, budget_cents, plan) VALUES ($1, $2, $3, $4)",
    [input.userId, input.month, input.budgetCents, input.plan]
  );
}

export async function findOutfitPrimaryItemId(input: {
  userId: string;
  outfitId: string;
}): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT plan FROM capsule_plans WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10",
    [input.userId]
  );
  for (const row of rows) {
    const outfits = Array.isArray(row.plan?.outfits) ? row.plan.outfits : [];
    const match = outfits.find((o: any) => o?.id === input.outfitId);
    if (match && Array.isArray(match.itemIds) && typeof match.itemIds[0] === "string") {
      return match.itemIds[0];
    }
  }
  return null;
}

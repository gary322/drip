import type { ChannelInboundEvent } from "./types.js";

export type ChannelIntent =
  | { kind: "set_budget"; monthlyBudget: number }
  | { kind: "upload_photo" }
  | { kind: "show_outfits" }
  | { kind: "tryon"; itemId?: string }
  | { kind: "checkout"; itemIds?: string[] }
  | { kind: "unknown" };

function parseBudgetUsd(text: string): number | null {
  const match = text.match(/(?:budget|spend|monthly\s*budget)[^0-9$]{0,15}\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function parseItemId(text: string): string | undefined {
  const match = text.match(/\b(prod_[a-zA-Z0-9_\-]+)\b/);
  return match?.[1];
}

function parseItemIds(text: string): string[] {
  const ids: string[] = [];
  const re = /\b(prod_[a-zA-Z0-9_\-]+)\b/g;
  for (const match of text.matchAll(re)) {
    const id = match[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function classifyChannelIntent(event: ChannelInboundEvent): ChannelIntent {
  const text = event.text?.trim() ?? "";
  const hasMedia = Array.isArray(event.media) && event.media.length > 0;

  if (hasMedia || /upload\s+(a\s+)?photo/i.test(text) || /my\s+photo/i.test(text)) {
    return { kind: "upload_photo" };
  }

  const budget = parseBudgetUsd(text);
  if (budget != null) {
    return { kind: "set_budget", monthlyBudget: budget };
  }

  if (/\boutfits?\b/i.test(text) || /\blooks?\b/i.test(text)) {
    return { kind: "show_outfits" };
  }

  if (/try\s*-?on/i.test(text) || /try\s+this/i.test(text)) {
    return { kind: "tryon", itemId: parseItemId(text) };
  }

  if (/\bcheckout\b/i.test(text) || /\bbuy\b/i.test(text) || /\bpurchase\b/i.test(text)) {
    const itemIds = parseItemIds(text);
    return { kind: "checkout", ...(itemIds.length > 0 ? { itemIds } : {}) };
  }

  return { kind: "unknown" };
}

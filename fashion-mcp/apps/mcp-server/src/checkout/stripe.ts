import Stripe from "stripe";
import { getConfig } from "../config.js";

export type StripeCheckoutItem = {
  id: string;
  title: string;
  brand: string;
  priceCents: number;
  currency: string;
  imageUrl: string | null;
};

export async function createStripeCheckoutSession(input: {
  userId: string;
  approvalToken: string;
  items: StripeCheckoutItem[];
  notes?: string;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{ sessionId: string; url: string }> {
  const cfg = getConfig();
  if (!cfg.STRIPE_SECRET_KEY) {
    throw new Error("stripe_secret_key_not_configured");
  }

  const stripe = new Stripe(cfg.STRIPE_SECRET_KEY);
  const baseUrl = cfg.PUBLIC_BASE_URL.replace(/\/$/, "");
  const successUrl =
    input.successUrl ??
    cfg.STRIPE_SUCCESS_URL ??
    `${baseUrl}/approve/${input.approvalToken}?status=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    input.cancelUrl ??
    cfg.STRIPE_CANCEL_URL ??
    `${baseUrl}/approve/${input.approvalToken}?status=cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: input.userId,
    metadata: {
      approvalToken: input.approvalToken,
      userId: input.userId,
      notes: input.notes ?? "",
    },
    line_items: input.items.map((item) => {
      const imageUrl = normalizeHttpUrl(item.imageUrl);
      return {
        quantity: 1,
        price_data: {
          currency: item.currency.toLowerCase(),
          unit_amount: item.priceCents,
          product_data: {
            name: item.title,
            description: item.brand,
            images: imageUrl ? [imageUrl] : undefined,
            metadata: { productId: item.id },
          },
        },
      };
    }),
  });

  if (!session.url) {
    throw new Error("stripe_checkout_session_missing_url");
  }

  return {
    sessionId: session.id,
    url: session.url,
  };
}

function normalizeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

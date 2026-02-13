import express from "express";
import Stripe from "stripe";
import { getConfig } from "../config.js";
import { processStripeWebhookEvent } from "../checkout/webhookProcessor.js";

export const stripeWebhookRoutes = express.Router();

stripeWebhookRoutes.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    const cfg = getConfig();
    if (!cfg.STRIPE_SECRET_KEY || !cfg.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "stripe_webhook_not_configured" });
    }

    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || signature.length === 0) {
      return res.status(400).json({ error: "missing_stripe_signature" });
    }
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "invalid_webhook_body" });
    }

    const stripe = new Stripe(cfg.STRIPE_SECRET_KEY);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, cfg.STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid_signature";
      return res.status(400).json({ error: "invalid_stripe_signature", message });
    }

    try {
      const result = await processStripeWebhookEvent(event);
      return res.status(200).json({
        received: true,
        handled: result.handled,
        duplicate: result.duplicate,
        reason: result.reason ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: "webhook_processing_failed", message });
    }
  }
);

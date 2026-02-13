import express from "express";
import { getConfig } from "../config.js";
import { buildWhatsAppInboundEvents, verifyWhatsAppSignature } from "../channels/whatsapp.js";
import { buildTelegramInboundEvent } from "../channels/telegram.js";
import { handleChannelInboundEvent } from "../channels/orchestrator.js";

export const channelWebhookRoutes = express.Router();

channelWebhookRoutes.get("/channels/whatsapp/webhook", (req, res) => {
  const cfg = getConfig();
  if (!cfg.WHATSAPP_ENABLED) {
    return res.status(503).json({ error: "whatsapp_disabled" });
  }

  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");

  if (mode === "subscribe" && token && token === cfg.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: "whatsapp_webhook_verification_failed" });
});

channelWebhookRoutes.post(
  "/channels/whatsapp/webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    const cfg = getConfig();
    if (!cfg.WHATSAPP_ENABLED) {
      return res.status(503).json({ error: "whatsapp_disabled" });
    }
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "invalid_body" });
    }

    const signatureHeader = req.header("x-hub-signature-256") ?? undefined;
    const signatureValidated = verifyWhatsAppSignature({
      appSecret: cfg.WHATSAPP_APP_SECRET ?? "",
      rawBody: req.body,
      signatureHeader,
    });

    let payload: unknown;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }

    const events = await buildWhatsAppInboundEvents({
      payload,
      signatureValidated,
    });

    for (const event of events) {
      await handleChannelInboundEvent(event);
    }

    // WhatsApp expects 200 quickly.
    return res.status(200).send("EVENT_RECEIVED");
  }
);

channelWebhookRoutes.post(
  "/channels/telegram/webhook",
  express.json({ limit: "2mb" }),
  async (req, res) => {
    const cfg = getConfig();
    if (!cfg.TELEGRAM_ENABLED) {
      return res.status(503).json({ error: "telegram_disabled" });
    }

    const secret = req.header("x-telegram-bot-api-secret-token") ?? "";
    const signatureValidated = secret.length > 0 && secret === cfg.TELEGRAM_WEBHOOK_SECRET_TOKEN;
    const event = await buildTelegramInboundEvent({
      update: req.body,
      signatureValidated,
    });

    if (event) {
      await handleChannelInboundEvent(event);
    }

    return res.status(200).json({ ok: true });
  }
);


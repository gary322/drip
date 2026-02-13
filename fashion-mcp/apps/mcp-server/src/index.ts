import "dotenv/config";
import express from "express";
import { pinoHttp } from "pino-http";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createFashionMcpServer } from "./mcp/server.js";
import { createTransportAndBind } from "./mcp/transport.js";
import { originGuard } from "./middleware/originGuard.js";
import { oauthProtectedResource } from "./auth/protectedResource.js";
import { health } from "./routes/health.js";
import { approvalRoutes } from "./routes/approval.js";
import { channelLinkingRoutes } from "./routes/channelLinking.js";
import { stripeWebhookRoutes } from "./routes/stripeWebhook.js";
import { getConfig } from "./config.js";
import { createInMemoryRateLimit } from "./middleware/rateLimit.js";
import { startTryonWorker } from "./tryon/worker.js";
import { channelWebhookRoutes } from "./routes/channelWebhooks.js";
import { channelOutboxRoutes } from "./routes/channelOutbox.js";
import { startChannelSenderWorker } from "./channels/senderWorker.js";
import { createWhatsAppSender } from "./channels/whatsappSender.js";
import { createTelegramSender } from "./channels/telegramSender.js";
import { ensureDatabaseUrl } from "./db/resolveDatabaseUrl.js";

async function main() {
  // In AWS, we prefer injecting an RDS master secret ARN and deriving DATABASE_URL at runtime.
  // This avoids storing DB credentials in Terraform state or plain env vars.
  await ensureDatabaseUrl();
  const config = getConfig();
  const PORT = config.PORT;

  const app = express();
  app.use(pinoHttp());
  // Stripe webhook requires the raw request body for signature validation.
  app.use(stripeWebhookRoutes);
  // WhatsApp signature verification also requires raw body parsing.
  app.use(channelWebhookRoutes);
  // Allow image data-uri uploads for photo ingestion + iMessage bridge uploads.
  // Production deployments should prefer direct-to-object-store uploads + signed URLs.
  app.use(express.json({ limit: "25mb" }));

  // Important for Streamable HTTP MCP servers (DNS rebinding protection):
  // validate Origin. (See MCP spec.)
  app.use(originGuard);

  const mcpRateLimit = createInMemoryRateLimit({
    windowMs: config.MCP_RATE_LIMIT_WINDOW_MS,
    max: config.MCP_RATE_LIMIT_MAX,
    keyPrefix: "mcp",
  });
  const approvalRateLimit = createInMemoryRateLimit({
    windowMs: config.APPROVAL_RATE_LIMIT_WINDOW_MS,
    max: config.APPROVAL_RATE_LIMIT_MAX,
    keyPrefix: "approval",
  });

  // Well-known endpoint that lets ChatGPT discover auth configuration.
  app.get("/.well-known/oauth-protected-resource", oauthProtectedResource);

  // Root index endpoint for quick operator sanity checks.
  app.get("/", (_req, res) => {
    res.status(200).json({
      service: "fashion-mcp",
      status: "ok",
      endpoints: {
        health: "/healthz",
        mcp: "/mcp",
        approval: "/approve/:token",
        channelLink: "/channels/link/:token",
        stripeWebhook: "/webhooks/stripe",
      },
    });
  });

  // Minimal health endpoint
  app.get("/healthz", health);

  const generatedDir = resolve(process.cwd(), config.TRYON_OUTPUT_DIR);
  await mkdir(generatedDir, { recursive: true });
  app.use("/generated", express.static(generatedDir, { maxAge: "1h", fallthrough: false }));

  const mediaDir = resolve(process.cwd(), config.MEDIA_DIR);
  await mkdir(mediaDir, { recursive: true });
  app.use("/media", express.static(mediaDir, { maxAge: "1h", fallthrough: false }));

  // Approval page endpoints (minimal external UI for explicit purchase consent)
  app.use(approvalRateLimit, approvalRoutes);
  app.use(approvalRateLimit, channelLinkingRoutes);

  // iMessage bridge endpoints (outbox + inbound relay)
  app.use(channelOutboxRoutes);

  // MCP server + transport binding
  const { mcpRouter, setup } = createTransportAndBind(createFashionMcpServer);

  // All MCP JSON-RPC traffic goes through POST /mcp
  app.use("/mcp", mcpRateLimit, mcpRouter);

  await setup();
  const worker = await startTryonWorker();
  const waSender =
    config.WHATSAPP_ENABLED ? await startChannelSenderWorker({
      channel: "whatsapp",
      sender: createWhatsAppSender(),
      pollIntervalMs: 1000,
    }) : null;
  const tgSender =
    config.TELEGRAM_ENABLED ? await startChannelSenderWorker({
      channel: "telegram",
      sender: createTelegramSender(),
      pollIntervalMs: 1000,
    }) : null;

  const server = app.listen(PORT, () => {
    console.log(`fashion-mcp listening on http://localhost:${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    worker.stop();
    waSender?.stop();
    tgSender?.stop();

    server.close(() => {
      process.exit(0);
    });
    // Force-exit if something is holding the event loop open.
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

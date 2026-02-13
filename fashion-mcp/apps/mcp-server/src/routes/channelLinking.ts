import express from "express";
import { completeChannelLink } from "../channels/linking.js";

export const channelLinkingRoutes = express.Router();

channelLinkingRoutes.get("/channels/link/:token", (req, res) => {
  const token = req.params.token;
  if (!token || token.length < 12) {
    return res.status(400).send("Invalid link token.");
  }

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Link channel account</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; }
      .card { max-width: 520px; border: 1px solid #ddd; border-radius: 12px; padding: 18px; }
      label { display:block; margin-bottom: 8px; font-size: 14px; color: #444; }
      input { width: 100%; padding: 10px; border: 1px solid #bbb; border-radius: 8px; margin-bottom: 12px; }
      button { padding: 10px 14px; border-radius: 8px; border: 1px solid #222; cursor: pointer; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Link your channel account</h2>
      <p>Complete linking by entering your user id from your authenticated session.</p>
      <form method="POST" action="/channels/link/complete">
        <input type="hidden" name="token" value="${token}" />
        <label for="userId">User ID</label>
        <input id="userId" name="userId" placeholder="auth0|..." required />
        <button type="submit">Complete link</button>
      </form>
    </div>
  </body>
</html>`);
});

channelLinkingRoutes.post("/channels/link/complete", express.urlencoded({ extended: false }), async (req, res) => {
  const token = String(req.body?.token ?? "");
  const userId = String(req.body?.userId ?? "");

  const result = await completeChannelLink({ token, userId });
  if (!result.ok) {
    return res.status(400).json({ ok: false, reason: result.reason });
  }

  return res.status(200).json({
    ok: true,
    linked: {
      channel: result.channel,
      channelUserId: result.channelUserId,
      channelConversationId: result.channelConversationId,
    },
  });
});

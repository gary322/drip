import express from "express";
import { getPool } from "../db/pool.js";
import { randomUUID } from "node:crypto";
import { getConfig } from "../config.js";
import { writeAuditEvent } from "../db/repos/auditRepo.js";

export const approvalRoutes = express.Router();

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = decodeURIComponent(pair.slice(idx + 1).trim());
    cookies[key] = value;
  }
  return cookies;
}

function getCsrfCookieName(token: string): string {
  return `approval_csrf_${token}`;
}

function makeCsrfCookie(token: string, csrfToken: string): string {
  const cfg = getConfig();
  const secure = cfg.PUBLIC_BASE_URL.startsWith("https://") ? "; Secure" : "";
  return `${getCsrfCookieName(token)}=${encodeURIComponent(csrfToken)}; Path=/approve/${token}; HttpOnly; SameSite=Strict; Max-Age=900${secure}`;
}

/**
 * In production: approval links should be single-use, signed, short-lived,
 * and should require strong user verification (e.g., re-auth).
 *
 * This starter implements a minimal approval page for demo purposes.
 */

approvalRoutes.get("/approve/:token", async (req, res) => {
  const token = req.params.token;
  if (!/^[a-zA-Z0-9]{12,}$/.test(token)) {
    return res.status(400).send("Invalid approval token.");
  }

  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM approvals WHERE token=$1", [token]);
  const approval = rows[0];
  if (!approval) return res.status(404).send("Approval not found.");

  const now = new Date();
  if (new Date(approval.expires_at) < now) {
    if (approval.status === "pending") {
      await pool.query("UPDATE approvals SET status='expired' WHERE token=$1", [token]);
    }
    return res.status(410).send("Approval expired.");
  }

  const payload = approval.payload;
  const csrfToken = randomUUID().replaceAll("-", "");
  res.setHeader("Set-Cookie", makeCsrfCookie(token, csrfToken));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'self' https: data:; img-src https: data:; style-src 'unsafe-inline' 'self';");

  res.setHeader("content-type", "text/html; charset=utf-8");
  const stripeCheckoutUrl =
    typeof payload?.stripeCheckoutUrl === "string" ? payload.stripeCheckoutUrl : null;
  const totalCents =
    typeof payload?.totalCents === "number"
      ? payload.totalCents
      : Array.isArray(payload?.items)
        ? payload.items.reduce((sum: number, item: any) => sum + Number(item?.priceCents ?? 0), 0)
        : 0;
  const monthlyBudgetCents =
    typeof payload?.monthlyBudgetCents === "number" ? payload.monthlyBudgetCents : 0;
  const withinBudget = monthlyBudgetCents <= 0 || totalCents <= monthlyBudgetCents;

  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Approve order</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; }
    .card { border: 1px solid #ddd; border-radius: 12px; padding: 16px; max-width: 760px; }
    .row { display:flex; gap:12px; align-items:center; margin: 12px 0; }
    img { width: 64px; height: 64px; object-fit: cover; border-radius: 10px; }
    button { padding: 10px 14px; border-radius: 10px; border: 1px solid #333; cursor:pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Approve your order</h2>
    <p>Status: <b>${escapeHtml(approval.status)}</b></p>
    <p>Order total: <b>$${(totalCents / 100).toFixed(2)}</b></p>
    ${
      monthlyBudgetCents > 0
        ? `<p>Monthly budget: <b>$${(monthlyBudgetCents / 100).toFixed(2)}</b> (${withinBudget ? "within budget" : "over budget"})</p>`
        : ""
    }
    <div>
      ${(payload.items ?? []).map((it:any)=>`
        <div class="row">
          <img src="${escapeHtml(it.imageUrl)}" alt=""/>
          <div style="flex:1">
            <div><b>${escapeHtml(it.title)}</b></div>
            <div>${escapeHtml(it.brand)} • ${escapeHtml(it.size ?? "")} • $${Number(it.priceCents/100).toFixed(2)}</div>
          </div>
        </div>
      `).join("")}
    </div>
    <form method="POST" action="/approve/${token}/decision">
      <input type="hidden" name="_csrf" value="${csrfToken}" />
      <button name="decision" value="approved" type="submit">Approve</button>
      <button name="decision" value="declined" type="submit">Decline</button>
    </form>
    ${
      stripeCheckoutUrl
        ? `<p style="margin-top:12px"><a href="${escapeHtml(stripeCheckoutUrl)}" target="_blank" rel="noopener"><button type="button">Pay with Stripe</button></a></p>`
        : ""
    }
    <p style="color:#666;margin-top:12px">
      This approval page is CSRF-protected and short-lived. Re-auth before approval is still recommended.
    </p>
  </div>
</body>
</html>`);
});

approvalRoutes.post("/approve/:token/decision", express.urlencoded({ extended: false }), async (req, res) => {
  const token = req.params.token;
  const decision = (req.body.decision ?? "").toString();
  const csrfInput = (req.body._csrf ?? "").toString();
  const cookies = parseCookies(req.headers.cookie);
  const csrfCookie = cookies[getCsrfCookieName(token)] ?? "";

  if (!["approved", "declined"].includes(decision)) {
    return res.status(400).send("Invalid decision.");
  }
  if (!csrfInput || csrfInput !== csrfCookie) {
    return res.status(403).send("CSRF validation failed.");
  }

  const pool = getPool();
  const update = await pool.query(
    "UPDATE approvals SET status=$1 WHERE token=$2 AND status='pending' RETURNING user_id",
    [decision, token]
  );

  if (!update.rowCount) return res.status(409).send("Already decided or not found.");
  await writeAuditEvent({
    actorUserId: update.rows[0].user_id,
    eventType: "checkout.approval.decision",
    entityType: "approval",
    entityId: token,
    payload: { decision },
  });
  res.setHeader("Set-Cookie", `${getCsrfCookieName(token)}=; Path=/approve/${token}; Max-Age=0; HttpOnly; SameSite=Strict`);
  res.redirect(`/approve/${token}`);
});

/**
 * Helper used by tool handlers to create a new approval record.
 */
export async function createApproval(userId: string, payload: any): Promise<{ token: string; url: string }> {
  const token = randomUUID().replace(/-/g, "");
  const cfg = getConfig();
  const base = cfg.PUBLIC_BASE_URL;
  const expires = new Date(Date.now() + cfg.APPROVAL_TTL_MINUTES * 60 * 1000);

  const pool = getPool();
  await pool.query(
    "INSERT INTO approvals(token, user_id, payload, expires_at) VALUES ($1,$2,$3,$4)",
    [token, userId, payload, expires.toISOString()]
  );

  return { token, url: `${base}/approve/${token}` };
}

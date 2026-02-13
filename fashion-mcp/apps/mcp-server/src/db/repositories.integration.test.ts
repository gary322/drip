import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { closePool, getPool } from "./pool.js";
import {
  ensureUser,
  getProfile,
  grantConsent,
  createPhotoSet,
  photoSetExists,
  photoSetHasApprovedPrimaryPhoto,
  setPhotoValidationResults,
  upsertBudgetAndGoals,
  upsertSizes,
} from "./repos/profileRepo.js";
import { addItemRating } from "./repos/feedbackRepo.js";
import { getViewportProducts } from "./repos/catalogRepo.js";
import { createTryonJob, getTryonJob, markTryonJobCompleted } from "./repos/tryonRepo.js";
import { writeAuditEvent } from "./repos/auditRepo.js";
import { createApproval } from "../routes/approval.js";
import {
  IdempotencyConflictError,
  getIdempotentResponse,
  saveIdempotentResponse,
} from "./repos/idempotencyRepo.js";
import { processStripeWebhookEvent } from "../checkout/webhookProcessor.js";

async function canConnect(): Promise<boolean> {
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

test("profile and catalog repositories support core flow", async (t) => {
  if (!(await canConnect())) {
    t.skip("database not reachable for integration test");
    return;
  }

  const runId = randomUUID().replace(/-/g, "");
  const userId = `integration_user_1_${runId}`;
  const productId = `prod_test_1_${runId}`;
  await ensureUser(userId);
  await upsertBudgetAndGoals({
    userId,
    monthlyBudget: 300,
    goals: ["work"],
    styleTags: ["minimal"],
  });
  await upsertSizes({
    userId,
    sizes: { tops: "M", shoes: "10" },
  });

  const pool = getPool();
  await pool.query(
    `INSERT INTO products(id, title, brand, category, price_cents, currency, image_url, retailer_url, sizes, x, y)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      productId,
      "Test Shirt",
      "BrandX",
      "tops",
      4500,
      "USD",
      "https://example.com/img.jpg",
      "https://example.com/product",
      ["M"],
      0.2,
      0.7,
    ]
  );

  await addItemRating({ userId, itemId: productId, rating: 1 });
  const profile = await getProfile(userId);
  assert.ok(profile);
  assert.equal(profile?.monthly_budget_cents, 30000);

  const viewport = await getViewportProducts({
    viewport: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 },
    limit: 20,
  });
  assert.ok(viewport.some((item) => item.id === productId));
});

test("try-on and approval repositories support async workflow", async (t) => {
  if (!(await canConnect())) {
    t.skip("database not reachable for integration test");
    return;
  }

  const runId = randomUUID().replace(/-/g, "");
  const userId = `integration_user_2_${runId}`;
  const productId = `prod_test_2_${runId}`;
  await ensureUser(userId);
  await grantConsent({
    userId,
    consentType: "tryon_photos",
    granted: true,
  });

  const photoSet = await createPhotoSet({
    userId,
    source: "chatgpt_upload",
    fileIds: ["file_1", "file_2"],
  });
  const exists = await photoSetExists({ userId, photoSetId: photoSet.photoSetId });
  assert.equal(exists, true);
  const validationSummary = await setPhotoValidationResults({
    userId,
    photoSetId: photoSet.photoSetId,
    updates: [
      {
        index: 0,
        status: "approved",
        isPrimary: true,
        report: { ok: true, reason: "ok", provider: "heuristic" },
      },
      {
        index: 1,
        status: "rejected",
        report: { ok: false, reason: "not_head_to_toe_likely", provider: "heuristic" },
      },
    ],
  });
  assert.equal(validationSummary.approvedCount, 1);
  assert.equal(validationSummary.rejectedCount, 1);
  const hasApprovedPrimary = await photoSetHasApprovedPrimaryPhoto({
    userId,
    photoSetId: photoSet.photoSetId,
  });
  assert.equal(hasApprovedPrimary, true);

  const job = await createTryonJob({
    userId,
    photoSetId: photoSet.photoSetId,
    mode: "item",
    targetId: productId,
  });
  await markTryonJobCompleted({
    userId,
    jobId: job.id,
    resultUrls: ["https://cdn.example.com/tryon/result.jpg"],
  });

  const storedJob = await getTryonJob({ userId, jobId: job.id });
  assert.ok(storedJob);
  assert.equal(storedJob?.status, "completed");
  assert.equal(storedJob?.result_urls.length, 1);

  await writeAuditEvent({
    actorUserId: userId,
    eventType: "tryon.test.completed",
    entityType: "tryon_job",
    entityId: job.id,
  });
  const pool = getPool();
  const auditCount = await pool.query("SELECT COUNT(*)::int AS count FROM audit_events WHERE actor_user_id=$1", [
    userId,
  ]);
  assert.equal(auditCount.rows[0].count > 0, true);

  await pool.query(
    `INSERT INTO products(id, title, brand, category, price_cents, currency, image_url, retailer_url, sizes, x, y)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      productId,
      "Test Jacket",
      "BrandY",
      "outerwear",
      15000,
      "USD",
      "https://example.com/jacket.jpg",
      "https://example.com/jacket",
      ["M"],
      0.4,
      0.8,
    ]
  );

  const approval = await createApproval(userId, {
    items: [{ id: productId }],
    notes: "integration",
  });
  assert.ok(approval.token.length > 10);
  const status = await pool.query("SELECT status FROM approvals WHERE token=$1", [approval.token]);
  assert.equal(status.rows[0].status, "pending");

  const idempotencyKey = `idk_${runId}`;
  const payload = { itemIds: [productId], notes: "integration" };
  await saveIdempotentResponse({
    userId,
    operation: "checkout.createApprovalLink",
    idempotencyKey,
    payload,
    response: { ok: true, token: approval.token },
  });
  const cached = await getIdempotentResponse({
    userId,
    operation: "checkout.createApprovalLink",
    idempotencyKey,
    payload,
  });
  assert.equal(cached.hit, true);
  assert.equal(cached.response?.token, approval.token);

  await assert.rejects(
    () =>
      getIdempotentResponse({
        userId,
        operation: "checkout.createApprovalLink",
        idempotencyKey,
        payload: { ...payload, notes: "mutated" },
      }),
    (error: unknown) => error instanceof IdempotencyConflictError
  );
});

test("stripe webhook processor updates approval status and dedupes events", async (t) => {
  if (!(await canConnect())) {
    t.skip("database not reachable for integration test");
    return;
  }

  const runId = randomUUID().replace(/-/g, "");
  const userId = `integration_user_webhook_${runId}`;
  await ensureUser(userId);

  const approval = await createApproval(userId, {
    type: "stripe_checkout",
    items: [{ id: "prod_005", title: "Test Tee", priceCents: 3800 }],
  });

  const event = {
    id: `evt_test_${runId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_${runId}`,
        metadata: { approvalToken: approval.token },
        payment_status: "paid",
        amount_total: 3800,
        currency: "usd",
        customer_details: { email: "buyer@example.com" },
      },
    },
  } as unknown as Stripe.Event;

  const first = await processStripeWebhookEvent(event);
  assert.equal(first.handled, true);
  assert.equal(first.duplicate, false);

  const pool = getPool();
  const approvalRow = await pool.query("SELECT status, payload FROM approvals WHERE token=$1", [approval.token]);
  assert.equal(approvalRow.rows[0].status, "approved");
  assert.equal(approvalRow.rows[0].payload?.stripeCheckoutSessionId, `cs_test_${runId}`);
  assert.equal(approvalRow.rows[0].payload?.stripePaymentStatus, "paid");

  const duplicate = await processStripeWebhookEvent(event);
  assert.equal(duplicate.handled, true);
  assert.equal(duplicate.duplicate, true);

  const eventCount = await pool.query("SELECT COUNT(*)::int AS count FROM stripe_webhook_events WHERE event_id=$1", [
    `evt_test_${runId}`,
  ]);
  assert.equal(eventCount.rows[0].count, 1);
});

after(async () => {
  await closePool();
});

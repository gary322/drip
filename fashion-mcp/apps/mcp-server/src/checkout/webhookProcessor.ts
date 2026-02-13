import Stripe from "stripe";
import { getPool } from "../db/pool.js";
import { writeAuditEvent } from "../db/repos/auditRepo.js";

export type WebhookProcessResult = {
  handled: boolean;
  duplicate: boolean;
  reason?: string;
};

async function markEventProcessed(event: Stripe.Event): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `INSERT INTO stripe_webhook_events(event_id, event_type)
     VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [event.id, event.type]
  );
  return (rowCount ?? 0) > 0;
}

export async function processStripeWebhookEvent(event: Stripe.Event): Promise<WebhookProcessResult> {
  const pool = getPool();
  const firstSeen = await markEventProcessed(event);
  if (!firstSeen) {
    return { handled: true, duplicate: true, reason: "duplicate_event" };
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded" &&
    event.type !== "checkout.session.expired" &&
    event.type !== "checkout.session.async_payment_failed"
  ) {
    return { handled: false, duplicate: false, reason: "event_type_not_handled" };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const approvalToken = session.metadata?.approvalToken;
  if (!approvalToken) {
    return { handled: false, duplicate: false, reason: "missing_approval_token" };
  }

  const status =
    event.type === "checkout.session.expired"
      ? "expired"
      : event.type === "checkout.session.async_payment_failed"
        ? "declined"
        : "approved";

  const payloadPatch = {
    stripeCheckoutSessionId: session.id,
    stripeLastEventId: event.id,
    stripeLastEventType: event.type,
    stripePaymentStatus: session.payment_status ?? null,
    stripeAmountTotal: session.amount_total ?? null,
    stripeCurrency: session.currency ?? null,
    stripeCustomerEmail: session.customer_details?.email ?? null,
  };

  const { rows, rowCount } = await pool.query(
    `UPDATE approvals
       SET status = CASE WHEN status='pending' THEN $2 ELSE status END,
           payload = payload || $3::jsonb
     WHERE token=$1
     RETURNING user_id, status`,
    [approvalToken, status, JSON.stringify(payloadPatch)]
  );

  if ((rowCount ?? 0) === 0) {
    return { handled: false, duplicate: false, reason: "approval_not_found" };
  }

  await writeAuditEvent({
    actorUserId: rows[0].user_id as string,
    eventType: "checkout.payment.webhook",
    entityType: "approval",
    entityId: approvalToken,
    payload: {
      eventId: event.id,
      eventType: event.type,
      stripeCheckoutSessionId: session.id,
      statusAfterUpdate: rows[0].status as string,
    },
  });

  return { handled: true, duplicate: false };
}

import { getPool } from "../pool.js";

export async function writeAuditEvent(input: {
  actorUserId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO audit_events(actor_user_id, event_type, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.actorUserId, input.eventType, input.entityType, input.entityId, input.payload ?? {}]
  );
}

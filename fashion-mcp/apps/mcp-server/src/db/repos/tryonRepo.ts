import { getPool } from "../pool.js";

export type TryonJobRow = {
  id: string;
  user_id: string;
  photo_set_id: string;
  mode: "item" | "outfit";
  target_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  result_urls: string[];
  error_message: string | null;
  requested_channel: string | null;
  requested_channel_user_id: string | null;
  requested_channel_conversation_id: string | null;
  requested_message_id: string | null;
  result_notified_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function createTryonJob(input: {
  userId: string;
  photoSetId: string;
  mode: "item" | "outfit";
  targetId: string;
  requestedChannel?: string;
  requestedChannelUserId?: string;
  requestedChannelConversationId?: string;
  requestedMessageId?: string;
}): Promise<TryonJobRow> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO tryon_jobs(
        user_id,
        photo_set_id,
        mode,
        target_id,
        status,
        requested_channel,
        requested_channel_user_id,
        requested_channel_conversation_id,
        requested_message_id
      )
     VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8)
     RETURNING *`,
    [
      input.userId,
      input.photoSetId,
      input.mode,
      input.targetId,
      input.requestedChannel ?? null,
      input.requestedChannelUserId ?? null,
      input.requestedChannelConversationId ?? null,
      input.requestedMessageId ?? null,
    ]
  );
  return rows[0] as TryonJobRow;
}

export async function claimNextTryonJob(): Promise<TryonJobRow | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sel = await client.query(
      `SELECT id
         FROM tryon_jobs
        WHERE status='queued'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );
    const id = sel.rows[0]?.id as string | undefined;
    if (!id) {
      await client.query("ROLLBACK");
      return null;
    }
    const updated = await client.query(
      `UPDATE tryon_jobs
          SET status='processing', updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [id]
    );
    await client.query("COMMIT");
    return updated.rows[0] as TryonJobRow;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getTryonJob(input: {
  userId: string;
  jobId: string;
}): Promise<TryonJobRow | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT * FROM tryon_jobs WHERE id=$1 AND user_id=$2",
    [input.jobId, input.userId]
  );
  return (rows[0] as TryonJobRow | undefined) ?? null;
}

export async function markTryonJobCompleted(input: {
  userId: string;
  jobId: string;
  resultUrls: string[];
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE tryon_jobs
        SET status='completed', result_urls=$3, updated_at=now()
      WHERE id=$1 AND user_id=$2`,
    [input.jobId, input.userId, input.resultUrls]
  );
}

export async function markTryonJobFailed(input: {
  userId: string;
  jobId: string;
  errorMessage: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE tryon_jobs
        SET status='failed', error_message=$3, updated_at=now()
      WHERE id=$1 AND user_id=$2`,
    [input.jobId, input.userId, input.errorMessage.slice(0, 500)]
  );
}

export async function markTryonJobNotified(input: {
  userId: string;
  jobId: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE tryon_jobs
        SET result_notified_at=now(), updated_at=now()
      WHERE id=$1 AND user_id=$2 AND result_notified_at IS NULL`,
    [input.jobId, input.userId]
  );
}

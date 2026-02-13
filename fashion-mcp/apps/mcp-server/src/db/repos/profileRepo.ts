import { getPool } from "../pool.js";

export type ProfileRecord = {
  user_id: string;
  monthly_budget_cents: number;
  currency: string;
  goals: string[];
  style_tags: string[];
  sizes: Record<string, unknown>;
  default_address: Record<string, unknown> | null;
};

export type PhotoValidationStatus = "pending" | "approved" | "rejected";

export type PhotoValidationUpdate = {
  index: number;
  status: PhotoValidationStatus;
  report: Record<string, unknown>;
  isPrimary?: boolean;
};

export async function ensureUser(userId: string): Promise<void> {
  const pool = getPool();
  await pool.query("INSERT INTO users(id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
  await pool.query("INSERT INTO profiles(user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
}

export async function getProfile(userId: string): Promise<ProfileRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM profiles WHERE user_id=$1", [userId]);
  return (rows[0] as ProfileRecord | undefined) ?? null;
}

export async function upsertBudgetAndGoals(input: {
  userId: string;
  monthlyBudget: number;
  goals: string[];
  styleTags: string[];
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE profiles
       SET monthly_budget_cents=$2, currency='USD', goals=$3, style_tags=$4, updated_at=now()
     WHERE user_id=$1`,
    [input.userId, Math.round(input.monthlyBudget * 100), input.goals, input.styleTags]
  );
}

export async function upsertSizes(input: {
  userId: string;
  sizes: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE profiles
       SET sizes = COALESCE(sizes, '{}'::jsonb) || $2::jsonb, updated_at=now()
     WHERE user_id=$1`,
    [input.userId, JSON.stringify(input.sizes)]
  );
}

export async function upsertDefaultAddress(input: {
  userId: string;
  address: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE profiles
       SET default_address=$2::jsonb, updated_at=now()
     WHERE user_id=$1`,
    [input.userId, JSON.stringify(input.address)]
  );
}

export async function grantConsent(input: {
  userId: string;
  consentType: string;
  granted: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO consents(user_id, consent_type, granted, metadata)
     VALUES ($1, $2, $3, $4)`,
    [input.userId, input.consentType, input.granted, input.metadata ?? {}]
  );
}

export async function hasActiveConsent(userId: string, consentType: string): Promise<boolean> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT granted
       FROM consents
      WHERE user_id=$1 AND consent_type=$2
      ORDER BY granted_at DESC
      LIMIT 1`,
    [userId, consentType]
  );
  return rows[0]?.granted === true;
}

export async function createPhotoSet(input: {
  userId: string;
  source: string;
  fileIds: string[];
  photoUrls?: string[];
}): Promise<{ photoSetId: string; fileCount: number }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const photoSetRes = await client.query(
      `INSERT INTO photo_sets(user_id, source)
       VALUES ($1, $2)
       RETURNING id`,
      [input.userId, input.source]
    );
    const photoSetId = photoSetRes.rows[0].id as string;

    for (let i = 0; i < input.fileIds.length; i += 1) {
      const fileId = input.fileIds[i];
      const storageUrl = input.photoUrls?.[i] ?? null;
      await client.query(
        `INSERT INTO photos(photo_set_id, user_id, file_id, storage_url)
         VALUES ($1, $2, $3, $4)`,
        [photoSetId, input.userId, fileId, storageUrl]
      );
    }

    await client.query("COMMIT");
    return { photoSetId, fileCount: input.fileIds.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePhotoSet(input: {
  userId: string;
  photoSetId: string;
}): Promise<boolean> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const photoSet = await client.query(
      "SELECT id FROM photo_sets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
      [input.photoSetId, input.userId]
    );
    if (!photoSet.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      "UPDATE photo_sets SET deleted_at=now() WHERE id=$1 AND user_id=$2",
      [input.photoSetId, input.userId]
    );
    await client.query(
      "UPDATE photos SET deleted_at=now() WHERE photo_set_id=$1 AND user_id=$2 AND deleted_at IS NULL",
      [input.photoSetId, input.userId]
    );

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function photoSetExists(input: { userId: string; photoSetId: string }): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    "SELECT 1 FROM photo_sets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
    [input.photoSetId, input.userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getPhotoSetImages(input: {
  userId: string;
  photoSetId: string;
}): Promise<Array<{
  id: string;
  storage_url: string | null;
  file_id: string;
  validation_status: PhotoValidationStatus;
  validation_report: Record<string, unknown>;
  is_primary: boolean;
}>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, storage_url, file_id, validation_status, validation_report, is_primary
       FROM photos
      WHERE user_id=$1 AND photo_set_id=$2 AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [input.userId, input.photoSetId]
  );
  return rows as Array<{
    id: string;
    storage_url: string | null;
    file_id: string;
    validation_status: PhotoValidationStatus;
    validation_report: Record<string, unknown>;
    is_primary: boolean;
  }>;
}

export async function setPhotoValidationResults(input: {
  userId: string;
  photoSetId: string;
  updates: PhotoValidationUpdate[];
}): Promise<{ approvedCount: number; rejectedCount: number; primaryPhotoId: string | null }> {
  if (input.updates.length === 0) {
    return { approvedCount: 0, rejectedCount: 0, primaryPhotoId: null };
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const photosResult = await client.query(
      `SELECT id
         FROM photos
        WHERE user_id=$1 AND photo_set_id=$2 AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [input.userId, input.photoSetId]
    );
    const orderedPhotoIds = photosResult.rows.map((row) => row.id as string);

    let approvedCount = 0;
    let rejectedCount = 0;
    let explicitPrimaryPhotoId: string | null = null;
    let fallbackPrimaryPhotoId: string | null = null;

    for (const update of input.updates) {
      const photoId = orderedPhotoIds[update.index];
      if (!photoId) continue;

      if (update.status === "approved") {
        approvedCount += 1;
        if (!fallbackPrimaryPhotoId) fallbackPrimaryPhotoId = photoId;
      }
      if (update.status === "rejected") {
        rejectedCount += 1;
      }
      if (update.isPrimary && update.status === "approved") {
        explicitPrimaryPhotoId = photoId;
      }

      await client.query(
        `UPDATE photos
            SET validation_status=$4,
                validation_report=$5::jsonb,
                is_primary=false
          WHERE id=$3 AND user_id=$1 AND photo_set_id=$2`,
        [input.userId, input.photoSetId, photoId, update.status, JSON.stringify(update.report ?? {})]
      );
    }

    const primaryPhotoId = explicitPrimaryPhotoId ?? fallbackPrimaryPhotoId;
    if (primaryPhotoId) {
      await client.query(
        `UPDATE photos
            SET is_primary=true
          WHERE id=$3 AND user_id=$1 AND photo_set_id=$2`,
        [input.userId, input.photoSetId, primaryPhotoId]
      );
    }

    await client.query("COMMIT");
    return { approvedCount, rejectedCount, primaryPhotoId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function photoSetHasApprovedPrimaryPhoto(input: {
  userId: string;
  photoSetId: string;
}): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM photos
      WHERE user_id=$1
        AND photo_set_id=$2
        AND deleted_at IS NULL
        AND validation_status='approved'
        AND is_primary=true
      LIMIT 1`,
    [input.userId, input.photoSetId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getLatestApprovedPhotoSetId(input: {
  userId: string;
}): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ps.id
       FROM photo_sets ps
       JOIN photos p
         ON p.photo_set_id = ps.id
        AND p.user_id = ps.user_id
      WHERE ps.user_id=$1
        AND ps.deleted_at IS NULL
        AND p.deleted_at IS NULL
        AND p.validation_status='approved'
        AND p.is_primary=true
      ORDER BY ps.created_at DESC
      LIMIT 1`,
    [input.userId]
  );
  const id = rows[0]?.id as string | undefined;
  return id ?? null;
}

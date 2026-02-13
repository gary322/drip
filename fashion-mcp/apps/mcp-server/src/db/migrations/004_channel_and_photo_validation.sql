-- Add strict photo validation metadata for full-body gating.

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS validation_report JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_photos_validation_status
  ON photos(user_id, photo_set_id, validation_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_photos_primary
  ON photos(user_id, photo_set_id, is_primary)
  WHERE deleted_at IS NULL;

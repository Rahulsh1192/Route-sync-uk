-- ============================================================================
-- Phase 25 — Cloudflare R2 video storage: multipart upload, SHA-256 dedup,
--            ABR HLS ladder, dual thumbnails, orphan cleanup
--
-- Scope note: almost everything this phase needs ALREADY EXISTS in this schema —
-- `uploads`/`upload_files` track the direct-to-storage flow, `route_videos` holds
-- object keys + manifest keys + codec/resolution/duration/size, `route_previews`
-- holds thumbnails, and `upload_stages` is the processing status. So this migration
-- deliberately adds the minimum: a content hash, multipart bookkeeping, one extra
-- thumbnail size, and a description of the HLS variant ladder.
--
-- What is NOT here, by instruction: no lifecycle rules, no archival tier, no
-- automatic deletion of valid videos. The only delete path added anywhere in this
-- phase is orphan cleanup, which by construction can only touch objects that no
-- database row references.
--
-- Idempotent: safe to run repeatedly.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Content hashing for deduplication
-- ----------------------------------------------------------------------------
-- Videos are uploaded once and kept forever, so an accidental re-upload of the same
-- footage costs storage permanently. A SHA-256 over the file's bytes is the only
-- reliable identity: filenames, sizes and timestamps all collide or drift, and the
-- existing `route_fingerprints` hash describes GPX GEOMETRY, not the video file, so
-- it cannot answer "are these the same bytes".
--
-- The hash lives on `upload_files` (what the contributor sent) and on `route_videos`
-- (what we published), because dedup has to work in both directions: skip an upload
-- that already exists, and find the existing object to point a new row at.
ALTER TABLE upload_files
  ADD COLUMN IF NOT EXISTS sha256              CHAR(64),
  -- Set when this file was NOT uploaded because an identical object already existed.
  -- The row still exists (the contributor did declare the file) but points at the
  -- object we already had — "reuse the object, add another metadata entry".
  ADD COLUMN IF NOT EXISTS dedup_of_key        TEXT,
  -- Multipart bookkeeping. Needed so an abandoned upload can be aborted: incomplete
  -- parts are billed but invisible in an object listing, so without the id they leak.
  ADD COLUMN IF NOT EXISTS multipart_upload_id TEXT,
  ADD COLUMN IF NOT EXISTS part_size_bytes     BIGINT,
  ADD COLUMN IF NOT EXISTS parts_total         INTEGER,
  ADD COLUMN IF NOT EXISTS parts_completed     INTEGER NOT NULL DEFAULT 0,
  -- Whether the object was confirmed present in storage (HEAD succeeded).
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ;

-- Not UNIQUE: the same bytes may legitimately be declared by several uploads (that is
-- exactly the dedup case). This index makes "have we seen these bytes?" a lookup.
CREATE INDEX IF NOT EXISTS idx_upload_files_sha256 ON upload_files (sha256)
  WHERE sha256 IS NOT NULL;

-- `route_videos` already carries storage_key, manifest_key, codec, width/height, fps,
-- duration_s, bytes and sync_offset_ms, so only the content hash, the variant ladder
-- and the object's provenance are genuinely new.
ALTER TABLE route_videos
  ADD COLUMN IF NOT EXISTS sha256     CHAR(64),
  -- The ABR ladder: [{"height":720,"bitrateKbps":2800,"playlistKey":"...","codec":"h264"}].
  -- Kept as JSONB on the existing row rather than in a new `route_video_variants`
  -- table: variants are always read together with their parent and never queried
  -- independently, so a child table would add a join and a migration for no benefit.
  ADD COLUMN IF NOT EXISTS variants   JSONB,
  -- Where the source object came from, for cost/forensics ('upload' | 'dedup').
  ADD COLUMN IF NOT EXISTS object_origin TEXT;

CREATE INDEX IF NOT EXISTS idx_route_videos_sha256 ON route_videos (sha256)
  WHERE sha256 IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Second thumbnail size
-- ----------------------------------------------------------------------------
-- `route_previews.thumbnail_key` already exists and becomes the 640x360 image; the
-- 320x180 is added alongside for list/grid views. Serving a 640-wide image into a
-- 320-wide slot is the single most common wasted-bandwidth mistake on a listing page,
-- and thumbnails are the one asset class we serve from the public CDN.
ALTER TABLE route_previews
  ADD COLUMN IF NOT EXISTS thumbnail_small_key TEXT,
  ADD COLUMN IF NOT EXISTS captured_at_ms      INTEGER;

-- ----------------------------------------------------------------------------
-- 3. Orphan upload tracking
-- ----------------------------------------------------------------------------
-- The failure this addresses: a client obtains a signed URL, successfully PUTs several
-- GB to R2, then never calls /uploads/:id/complete (tab closed, crash, lost network).
-- The bytes are in the bucket and billed, and nothing in the app will ever reference
-- them. Those objects — and only those — are what cleanup removes.
--
-- `cleanup_state` makes the sweep auditable rather than a silent background delete:
--   pending  → not yet examined
--   retained → examined and deliberately kept (it is referenced / still in progress)
--   swept    → its unreferenced objects were removed
ALTER TABLE uploads
  ADD COLUMN IF NOT EXISTS cleanup_state     TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cleaned_up_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleanup_note      TEXT,
  -- Bytes reclaimed, so the cron can report what it actually saved.
  ADD COLUMN IF NOT EXISTS bytes_reclaimed   BIGINT;

-- Partial index: the sweep only ever looks at uploads that never completed, which is a
-- small minority of rows, so indexing just those keeps it cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_uploads_cleanup
  ON uploads (status, created_at)
  WHERE status IN ('created', 'uploading', 'failed');

-- ----------------------------------------------------------------------------
-- 4. Tunables
-- ----------------------------------------------------------------------------
INSERT INTO platform_config (key, value) VALUES
  -- How long an incomplete upload is left alone before it counts as abandoned. Long
  -- enough that a genuinely slow 5 GB upload on a poor connection is never swept.
  ('upload_orphan_age_hours',   '24'),
  -- Safety valve: a sweep that wants to delete more than this many objects in one run
  -- stops and reports instead. A mass-delete is far more likely to be a bug in the
  -- reference query than a real backlog of abandoned uploads.
  ('upload_orphan_max_objects', '500'),
  -- Multipart part size. 64 MB keeps a 5 GB file to ~80 parts (well under the 10,000
  -- limit) while being small enough that retrying one failed part is cheap.
  ('upload_part_size_mb',       '64'),
  -- Above this size the client is told to use multipart rather than a single PUT.
  ('upload_multipart_threshold_mb', '100'),
  -- ABR ladder. Heights are capped to the source resolution at encode time, so a 720p
  -- dashcam never gets an upscaled (larger, worse) 1080p rendition.
  ('hls_ladder', '[{"height":1080,"bitrateKbps":5000},{"height":720,"bitrateKbps":2800},{"height":480,"bitrateKbps":1400},{"height":360,"bitrateKbps":800}]'),
  -- Delivery codec. 'h264' is the only accepted value: hls.js cannot decode HEVC through
  -- Media Source Extensions on Chrome/Firefox, so anything else would leave most of the
  -- audience unable to play the footage. The worker overrides other values and logs it
  -- (ffmpeg_ops.resolve_codec), so this row records the decision rather than enabling one.
  ('hls_codec',                 'h264'),
  ('hls_segment_seconds',       '6'),
  -- Thumbnail capture point. 10 s in, so it lands after the car is actually moving
  -- rather than on a stationary frame in the test-centre car park.
  ('thumbnail_at_seconds',      '10')
  ON CONFLICT (key) DO NOTHING;

COMMIT;

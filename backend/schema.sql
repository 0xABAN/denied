-- Identifiers are quoted by telemetry.initialize(). Both tables use event time
-- in one UTC date column; durations remain separate from timestamps.
CREATE TABLE IF NOT EXISTS {table} (
    event_id UUID PRIMARY KEY,
    date TIMESTAMPTZ NOT NULL,
    document_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    page_host TEXT NOT NULL,
    page_scheme TEXT NOT NULL CHECK (page_scheme IN ('http', 'https')),
    removed_text TEXT NOT NULL CHECK (char_length(removed_text) <= 24000),
    text_truncated BOOLEAN NOT NULL,
    reasons TEXT[] NOT NULL,
    classifications JSONB NOT NULL,
    judge_ms INTEGER NOT NULL CHECK (judge_ms >= 0),
    total_ms BIGINT NOT NULL CHECK (total_ms >= 0),
    UNIQUE (document_id, target_id, revision)
);

-- Upgrade the earlier removal schema transactionally. Preserve actual removal
-- time and content; the old recorded_at index disappears with its column.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = {schema} AND table_name = 'removals' AND column_name = 'removed_at') THEN
        ALTER TABLE {table} RENAME COLUMN removed_at TO date;
        ALTER TABLE {table} DROP COLUMN detected_at, DROP COLUMN judged_at, DROP COLUMN recorded_at;
    END IF;
END $$;

-- Prune old JSON metadata even when the date-column migration already ran.
-- ponytail: scan at startup; use versioned migrations if history grows large.
UPDATE {table} SET classifications = COALESCE(
    (SELECT jsonb_agg(item - ARRAY['judged_at', 'remove', 'policy_version', 'model_version', 'judge_ms'])
     FROM jsonb_array_elements(classifications) AS item),
    '[]'::jsonb
)
WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(classifications) AS item
    WHERE item ?| ARRAY['judged_at', 'remove', 'policy_version', 'model_version', 'judge_ms']
);
CREATE INDEX IF NOT EXISTS removals_date_idx ON {table} (date DESC);

-- One row per passage per actual Jev evaluation, including keep decisions.
-- A new batch_id distinguishes genuine re-evaluations of the same revision.
CREATE TABLE IF NOT EXISTS {judgments} (
    batch_id UUID NOT NULL,
    candidate_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    date TIMESTAMPTZ NOT NULL,
    page_host TEXT NOT NULL,
    page_scheme TEXT NOT NULL CHECK (page_scheme IN ('http', 'https')),
    text TEXT NOT NULL CHECK (char_length(text) <= 24000),
    links JSONB NOT NULL,
    ad JSONB NOT NULL,
    ad_score DOUBLE PRECISION NOT NULL CHECK (ad_score BETWEEN 0 AND 1),
    unsafe_score DOUBLE PRECISION NOT NULL CHECK (unsafe_score BETWEEN 0 AND 1),
    decision TEXT NOT NULL CHECK (decision IN ('keep', 'remove')),
    reasons TEXT[] NOT NULL,
    ad_threshold DOUBLE PRECISION NOT NULL CHECK (ad_threshold BETWEEN 0 AND 1),
    safety_threshold DOUBLE PRECISION NOT NULL CHECK (safety_threshold BETWEEN 0 AND 1),
    policy_version TEXT NOT NULL,
    model_version TEXT NOT NULL,
    judge_ms INTEGER NOT NULL CHECK (judge_ms >= 0),
    PRIMARY KEY (batch_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS judgments_date_idx ON {judgments} (date DESC);

-- Existing installations stored passages; independent requests now retain a whole block.
ALTER TABLE {judgments} DROP CONSTRAINT IF EXISTS judgments_text_check;
ALTER TABLE {judgments} ADD CONSTRAINT judgments_text_check CHECK (char_length(text) <= 24000);

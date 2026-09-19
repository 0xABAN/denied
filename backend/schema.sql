-- {table} is replaced with a quoted schema/table identifier by telemetry.initialize().
-- A regular PostgreSQL table on Tiger supports global idempotency without a second
-- deduplication table. Add time partitioning only when measured volume warrants it.
CREATE TABLE IF NOT EXISTS {table} (
    event_id UUID PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    document_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    page_host TEXT NOT NULL,
    page_scheme TEXT NOT NULL CHECK (page_scheme IN ('http', 'https')),
    removed_text TEXT NOT NULL CHECK (char_length(removed_text) <= 24000),
    text_truncated BOOLEAN NOT NULL,
    reasons TEXT[] NOT NULL,
    classifications JSONB NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    judged_at TIMESTAMPTZ NOT NULL,
    removed_at TIMESTAMPTZ NOT NULL,
    judge_ms INTEGER NOT NULL CHECK (judge_ms >= 0),
    total_ms BIGINT NOT NULL CHECK (total_ms >= 0),
    UNIQUE (document_id, target_id, revision)
);
CREATE INDEX IF NOT EXISTS removals_recorded_at_idx ON {table} (recorded_at DESC);

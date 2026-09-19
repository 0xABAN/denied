CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS decision_events (
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_id UUID NOT NULL,
    page_session_id UUID NOT NULL,
    candidate_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    decision TEXT NOT NULL CHECK (decision IN ('remove', 'keep', 'unavailable')),
    reasons TEXT[] NOT NULL DEFAULT '{}',
    ad_score DOUBLE PRECISION,
    unsafe_score DOUBLE PRECISION,
    latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
    policy_version TEXT NOT NULL,
    model_version TEXT NOT NULL
) WITH (
    tsdb.hypertable,
    tsdb.partition_column = 'recorded_at'
);

CREATE INDEX IF NOT EXISTS decision_events_recorded_at_idx
    ON decision_events (recorded_at DESC);

CREATE INDEX IF NOT EXISTS decision_events_event_id_idx
    ON decision_events (event_id);

CREATE TABLE IF NOT EXISTS decision_outcomes (
    outcome_id UUID PRIMARY KEY,
    event_id UUID NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    outcome TEXT NOT NULL CHECK (outcome IN (
        'applied', 'kept', 'stale_discarded', 'candidate_missing',
        'animation_finished', 'fallback_removed', 'provider_error'
    ))
);

CREATE INDEX IF NOT EXISTS decision_outcomes_event_id_idx
    ON decision_outcomes (event_id);

from collections.abc import Mapping
from uuid import UUID, uuid4

import psycopg

from .models import DecisionInput, MetricsResponse, Outcome, Reason


class DecisionRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    def insert_decision(
        self, event_id: UUID, item: DecisionInput, decision: str, reasons: list[Reason]
    ) -> None:
        with psycopg.connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO decision_events (
                        event_id, page_session_id, candidate_id, revision, decision, reasons,
                        ad_score, unsafe_score, latency_ms, policy_version, model_version
                    ) VALUES (
                        %(event_id)s, %(page_session_id)s, %(candidate_id)s, %(revision)s,
                        %(decision)s, %(reasons)s, %(ad_score)s, %(unsafe_score)s,
                        %(latency_ms)s, %(policy_version)s, %(model_version)s
                    )
                    """,
                    {
                        "event_id": event_id,
                        "page_session_id": item.page_session_id,
                        "candidate_id": item.candidate_id,
                        "revision": item.revision,
                        "decision": decision,
                        "reasons": [reason.value for reason in reasons],
                        "ad_score": item.ad_score,
                        "unsafe_score": item.unsafe_score,
                        "latency_ms": item.latency_ms,
                        "policy_version": item.policy_version,
                        "model_version": item.model_version,
                    },
                )

    def insert_outcome(self, event_id: UUID, outcome: Outcome) -> UUID:
        outcome_id = uuid4()
        with psycopg.connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO decision_outcomes (outcome_id, event_id, outcome)
                    VALUES (%s, %s, %s)
                    """,
                    (outcome_id, event_id, outcome.value),
                )
        return outcome_id

    def metrics(self) -> MetricsResponse:
        with psycopg.connect(self.database_url) as connection:
            with connection.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute(
                    """
                    SELECT
                        COUNT(*) AS total_decisions,
                        COUNT(*) FILTER (WHERE decision = 'remove') AS removals,
                        COUNT(*) FILTER (WHERE decision = 'keep') AS keeps,
                        COUNT(*) FILTER (WHERE decision = 'unavailable') AS unavailable,
                        percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median_latency_ms
                    FROM decision_events
                    """
                )
                row: Mapping[str, object] = cursor.fetchone()
        return MetricsResponse(**row)

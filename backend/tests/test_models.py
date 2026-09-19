import unittest
from uuid import uuid4

from app.models import Decision, DecisionInput, Reason


def payload(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "page_session_id": uuid4(),
        "candidate_id": "candidate-7",
        "revision": 1,
        "ad_score": 0.2,
        "unsafe_score": 0.1,
        "ad_threshold": 0.8,
        "safety_threshold": 0.75,
        "latency_ms": 120,
        "policy_version": "v1",
        "model_version": "jev-latest",
    }
    base.update(overrides)
    return base


class DecisionInputTests(unittest.TestCase):
    def test_keeps_below_threshold_scores(self) -> None:
        decision, reasons = DecisionInput(**payload()).decision()
        self.assertEqual(decision, Decision.KEEP)
        self.assertEqual(reasons, [])

    def test_removes_for_both_filters(self) -> None:
        decision, reasons = DecisionInput(
            **payload(ad_score=0.9, unsafe_score=0.9)
        ).decision()
        self.assertEqual(decision, Decision.REMOVE)
        self.assertEqual(reasons, [Reason.AD, Reason.UNSAFE])

    def test_records_unavailable_when_scores_are_missing(self) -> None:
        decision, reasons = DecisionInput(
            **payload(ad_score=None, unsafe_score=None)
        ).decision()
        self.assertEqual(decision, Decision.UNAVAILABLE)
        self.assertEqual(reasons, [])

from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Decision(StrEnum):
    REMOVE = "remove"
    KEEP = "keep"
    UNAVAILABLE = "unavailable"


class Reason(StrEnum):
    AD = "ad"
    UNSAFE = "unsafe"


class Outcome(StrEnum):
    APPLIED = "applied"
    KEPT = "kept"
    STALE_DISCARDED = "stale_discarded"
    CANDIDATE_MISSING = "candidate_missing"
    ANIMATION_FINISHED = "animation_finished"
    FALLBACK_REMOVED = "fallback_removed"
    PROVIDER_ERROR = "provider_error"


class DecisionInput(BaseModel):
    """No raw page evidence belongs in this model or its database representation."""

    model_config = ConfigDict(extra="forbid")

    page_session_id: UUID
    candidate_id: str = Field(min_length=1, max_length=128)
    revision: int = Field(ge=0)
    ad_score: float | None = Field(default=None, ge=0, le=1)
    unsafe_score: float | None = Field(default=None, ge=0, le=1)
    ad_threshold: float = Field(ge=0, le=1)
    safety_threshold: float = Field(ge=0, le=1)
    latency_ms: int = Field(ge=0, le=60_000)
    policy_version: str = Field(min_length=1, max_length=64)
    model_version: str = Field(min_length=1, max_length=128)

    @field_validator("candidate_id", "policy_version", "model_version")
    @classmethod
    def no_newlines(cls, value: str) -> str:
        if "\n" in value or "\r" in value:
            raise ValueError("must not contain line breaks")
        return value

    @model_validator(mode="after")
    def scores_are_present_together(self) -> "DecisionInput":
        if (self.ad_score is None) != (self.unsafe_score is None):
            raise ValueError("ad_score and unsafe_score must both be present or both be absent")
        return self

    def decision(self) -> tuple[Decision, list[Reason]]:
        if self.ad_score is None or self.unsafe_score is None:
            return Decision.UNAVAILABLE, []
        reasons: list[Reason] = []
        if self.ad_score >= self.ad_threshold:
            reasons.append(Reason.AD)
        if self.unsafe_score >= self.safety_threshold:
            reasons.append(Reason.UNSAFE)
        return (Decision.REMOVE if reasons else Decision.KEEP), reasons


class DecisionResponse(BaseModel):
    event_id: UUID
    decision: Decision
    reasons: list[Reason]


class OutcomeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    outcome: Outcome


class OutcomeResponse(BaseModel):
    outcome_id: UUID


class MetricsResponse(BaseModel):
    total_decisions: int
    removals: int
    keeps: int
    unavailable: int
    median_latency_ms: float | None

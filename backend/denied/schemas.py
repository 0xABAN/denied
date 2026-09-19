"""The HTTP boundary: bounded evidence in, finite typed judgments out."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z0-9:_-]{1,80}$")]
Host = Annotated[str, Field(max_length=253)]
Scheme = Annotated[str, Field(max_length=32, pattern=r"^(?:[a-z][a-z0-9+.-]*)?$")]
Probability = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Reason = Literal["advertising", "unsafe_content"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Link(StrictModel):
    label: str = Field(max_length=160)
    destination_host: Host
    destination_scheme: Scheme = ""


class AdEvidence(StrictModel):
    tag: str = Field(max_length=20)
    tokens: str = Field(max_length=160)
    label: str = Field(max_length=100)
    source_host: Host
    source_scheme: Scheme = ""
    known_host: bool
    attributes: list[Annotated[str, Field(max_length=64)]] = Field(default_factory=list, max_length=8)
    network: str = Field(default="", max_length=64)


class Candidate(StrictModel):
    id: Identifier
    revision: int = Field(ge=1)
    text: str = Field(max_length=1000)
    links: list[Link] = Field(max_length=8)
    ad: AdEvidence


class Batch(StrictModel):
    document_id: Identifier
    page_host: Host
    page_scheme: Literal["http", "https"]
    candidates: list[Candidate] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [candidate.id for candidate in self.candidates]
        if len(set(ids)) != len(ids):
            raise ValueError("Candidate IDs must be unique")
        return self


class Noul(StrictModel):
    type: Literal["noul"]
    noul: Probability


class Decision(StrictModel):
    id: Identifier
    revision: int
    ad_score: Probability
    unsafe_score: Probability
    remove: bool
    reasons: list[Reason]


class Judgments(StrictModel):
    document_id: Identifier
    policy_version: str
    results: list[Decision]

from functools import lru_cache
from secrets import compare_digest
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, status

from .config import Settings
from .models import (
    DecisionInput,
    DecisionResponse,
    MetricsResponse,
    OutcomeInput,
    OutcomeResponse,
)
from .repository import DecisionRepository

app = FastAPI(title="denied. decision telemetry", version="0.1.0")


@lru_cache
def settings() -> Settings:
    return Settings.from_environment()


@lru_cache
def repository() -> DecisionRepository:
    return DecisionRepository(settings().tiger_database_url)


def require_backend_token(
    x_backend_token: str | None = Header(default=None),
) -> None:
    if x_backend_token is None or not compare_digest(
        x_backend_token, settings().backend_api_token
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/decisions",
    response_model=DecisionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_backend_token)],
)
def record_decision(item: DecisionInput) -> DecisionResponse:
    decision, reasons = item.decision()
    event_id = uuid4()
    repository().insert_decision(event_id, item, decision.value, reasons)
    return DecisionResponse(event_id=event_id, decision=decision, reasons=reasons)


@app.post(
    "/outcomes",
    response_model=OutcomeResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_backend_token)],
)
def record_outcome(item: OutcomeInput) -> OutcomeResponse:
    outcome_id = repository().insert_outcome(item.event_id, item.outcome)
    return OutcomeResponse(outcome_id=outcome_id)


@app.get(
    "/metrics",
    response_model=MetricsResponse,
    dependencies=[Depends(require_backend_token)],
)
def metrics() -> MetricsResponse:
    return repository().metrics()

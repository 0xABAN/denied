"""Loopback API. Hosting requires an explicit authentication/deployment boundary."""

import asyncio
from contextlib import asynccontextmanager
import os
import re
from secrets import compare_digest
from time import perf_counter

import httpx
import psycopg
from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .judge import MODEL_VERSION, POLICY_VERSION, judge
from .schemas import Batch
from . import telemetry


def load_environment(path: str | os.PathLike[str] | None = None) -> None:
    """Load the backend's local environment without overriding shell settings."""
    dotenv_path = path or os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    load_dotenv(dotenv_path=dotenv_path, override=False)


class Unavailable(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


def create_app() -> FastAPI:
    key = os.environ.get("TYPESAFE_API_KEY", "")
    ad_threshold = float(os.environ.get("DENIED_AD_THRESHOLD", "0.70"))
    safety_threshold = float(os.environ.get("DENIED_SAFETY_THRESHOLD", "0.80"))
    if not (0 <= ad_threshold <= 1 and 0 <= safety_threshold <= 1):
        raise ValueError("Invalid thresholds")
    token = os.environ.get("BACKEND_API_TOKEN", "")
    recording = os.environ.get("DENIED_RECORD_REMOVALS", "1") == "1" and telemetry.configured() and len(token) >= 32

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with httpx.AsyncClient(timeout=6, trust_env=False) as connection:
            app.state.client = connection
            app.state.slots = asyncio.Semaphore(2)
            app.state.storage_slots = asyncio.Semaphore(4)
            app.state.recording_error = None
            if recording:
                try:
                    await asyncio.to_thread(telemetry.initialize)
                except (psycopg.Error, ValueError):
                    app.state.recording_error = "Removal history unavailable"
            yield

    api = FastAPI(title="denied.", lifespan=lifespan, docs_url=None, redoc_url=None)
    api.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    @api.exception_handler(Unavailable)
    async def unavailable(_request: Request, error: Unavailable):
        return JSONResponse({"error": error.message}, status_code=error.status)

    @api.middleware("http")
    async def local_boundary(request: Request, call_next):
        # Websites must not use a local API key through simple requests or DNS rebinding.
        # This is a loopback demo boundary, not authentication for a hosted service.
        origin = request.headers.get("origin")
        if origin and not re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
            return JSONResponse({"error": "Website requests are not allowed"}, status_code=403)
        if request.method == "POST" and request.headers.get("content-type", "").split(";")[0] != "application/json":
            return JSONResponse({"error": "Expected application/json"}, status_code=415)
        return await call_next(request)

    @api.get("/health")
    async def health():
        return {"configured": bool(key), "policy_version": POLICY_VERSION,
                "ad_threshold": ad_threshold, "safety_threshold": safety_threshold,
                "recording_enabled": recording, "recording_error": api.state.recording_error}

    async def read_body(request: Request, limit: int) -> bytes:
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > limit:
                raise Unavailable(413, "Request too large")
        return bytes(body)

    @api.post("/judge")
    async def evaluate(request: Request):
        try:
            batch = Batch.model_validate_json(await read_body(request, 128 * 1024))
        except ValidationError:
            raise Unavailable(422, "Invalid judgment request") from None
        if not key:
            raise Unavailable(503, "Set TYPESAFE_API_KEY in the backend environment")

        try:
            # The overall deadline includes queue time.
            async with asyncio.timeout(8), api.state.slots:
                started = perf_counter()
                judgments = await judge(api.state.client, batch, key, ad_threshold, safety_threshold)
                judge_ms = round((perf_counter() - started) * 1000)
        except (TimeoutError, httpx.TimeoutException):
            raise Unavailable(504, "Judgment timed out; content was not checked") from None
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            # Do not return provider bodies, which can contain supplied page text or credentials.
            raise Unavailable(502, "Provider unavailable or returned an invalid judgment") from None
        if recording:
            telemetry.issue_receipts(batch, judgments, token, judge_ms, ad_threshold, safety_threshold, MODEL_VERSION)
        return judgments

    async def storage_call(function, *args):
        # Storage has its own slots/deadline and never participates in /judge.
        if not telemetry.configured():
            raise Unavailable(503, "Removal recording is not configured")
        try:
            async with asyncio.timeout(8), api.state.storage_slots:
                result = await asyncio.to_thread(function, *args)
            api.state.recording_error = None
            return result
        except (TimeoutError, psycopg.Error, ValueError):
            api.state.recording_error = "Removal history unavailable"
            raise Unavailable(503, "Removal history unavailable; filtering remains active") from None

    @api.post("/outcomes")
    async def record_removal(request: Request):
        if not recording:
            raise Unavailable(503, "Removal recording is not configured")
        try:
            item = telemetry.Removal.model_validate_json(await read_body(request, 384 * 1024))
        except ValidationError:
            raise Unavailable(422, "Invalid removal record") from None
        try:
            row = telemetry.removal_row(item, token)
        except (ValueError, TypeError):
            raise Unavailable(403, "Invalid or expired removal receipt") from None
        await storage_call(telemetry.insert, row)
        return {"event_id": str(row["event_id"])}

    def require_token(x_backend_token: str | None = Header(default=None)):
        if len(token) < 32 or not x_backend_token or not compare_digest(x_backend_token.encode(), token.encode()):
            raise Unavailable(401, "Unauthorized")

    @api.get("/removals", dependencies=[Depends(require_token)])
    async def removals(limit: int = Query(default=20, ge=1, le=100)):
        return {"items": await storage_call(telemetry.recent, limit)}

    @api.get("/metrics", dependencies=[Depends(require_token)])
    async def metrics():
        return await storage_call(telemetry.metrics)

    return api


load_environment()
app = create_app()

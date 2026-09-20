"""Loopback API. Hosting requires an explicit authentication/deployment boundary."""

import asyncio
import json
from contextlib import asynccontextmanager
import os
import re
from secrets import compare_digest
from time import perf_counter
from typing import Literal

import httpx
import psycopg
from fastapi import BackgroundTasks, Depends, FastAPI, Header, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from dotenv import load_dotenv
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .judge import MODEL_VERSION, POLICY_VERSION, judge, judge_domain
from .schemas import Batch, DomainRequest, Wave
from . import telemetry
from .dispatch import Admission
from .reuse import DocumentReuse


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
    safety_threshold = float(os.environ.get("DENIED_SAFETY_THRESHOLD", "0.60"))
    if not (0 <= ad_threshold <= 1 and 0 <= safety_threshold <= 1):
        raise ValueError("Invalid thresholds")
    token = os.environ.get("BACKEND_API_TOKEN", "")
    # Honor the old off switch so upgrades cannot silently re-enable recording.
    history_enabled = os.environ.get("DENIED_RECORD_HISTORY", os.environ.get("DENIED_RECORD_REMOVALS", "1")) == "1"
    recording = history_enabled and telemetry.configured() and len(token) >= 32
    reuse_enabled = os.environ.get("DENIED_DOCUMENT_REUSE", "1") != "0"

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with httpx.AsyncClient(timeout=15, trust_env=False,
                                    # Reuse warm connections across intermittent waves
                                    # rather than paying repeated TLS setup costs.
                                    limits=httpx.Limits(max_connections=600, max_keepalive_connections=100,
                                                       keepalive_expiry=60)) as connection:
            app.state.client = connection
            app.state.slots = asyncio.Semaphore(600)
            app.state.admission = Admission()
            app.state.storage_slots = asyncio.Semaphore(4)
            app.state.recording_error = None
            app.state.reuse = DocumentReuse()
            if recording:
                try:
                    await asyncio.to_thread(telemetry.initialize)
                except (psycopg.Error, ValueError):
                    app.state.recording_error = "History unavailable"
            try:
                yield
            finally:
                await app.state.reuse.close()

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
                "recording_enabled": recording, "recording_error": api.state.recording_error,
                "document_reuse": {"enabled": reuse_enabled, "hits": api.state.reuse.hits,
                                   "misses": api.state.reuse.misses, "inference_batches": api.state.reuse.requests}}

    async def read_body(request: Request, limit: int) -> bytes:
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > limit:
                raise Unavailable(413, "Request too large")
        return bytes(body)

    async def infer(batch: Batch):
        async with api.state.slots:
            started = perf_counter()
            judgments = await judge(api.state.client, batch, key, ad_threshold, safety_threshold,
                                    admission=api.state.admission)
            return judgments, round((perf_counter() - started) * 1000)

    async def evaluate_batch(batch: Batch, background: BackgroundTasks):
        try:
            # Admission may wait for a rate window; inference gets its own deadline.
            judgments, judge_ms = await api.state.reuse.evaluate(batch, infer) if reuse_enabled else await infer(batch)
        except (TimeoutError, httpx.TimeoutException):
            raise Unavailable(504, "Judgment timed out; content was not checked") from None
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            # Do not return provider bodies, which can contain supplied page text or credentials.
            raise Unavailable(502, "Provider unavailable or returned an invalid judgment") from None
        if recording:
            rows = telemetry.prepare_judgments(batch, judgments, token, judge_ms, ad_threshold, safety_threshold, MODEL_VERSION)
            background.add_task(record_judgments, rows)
        return judgments

    async def read_judgment_request(request: Request, schema):
        try:
            value = schema.model_validate_json(await read_body(request, 2_000_000))
        except ValidationError:
            raise Unavailable(422, "Invalid judgment request") from None
        if not key:
            raise Unavailable(503, "Set TYPESAFE_API_KEY in the backend environment")
        return value

    @api.post("/judge")
    async def evaluate(request: Request, background: BackgroundTasks):
        batch = await read_judgment_request(request, Batch)
        return await evaluate_batch(batch, background)

    @api.post("/judge-domain")
    async def evaluate_domain(request: Request, background: BackgroundTasks):
        domain = await read_judgment_request(request, DomainRequest)
        try:
            async with api.state.slots:
                started = perf_counter()
                judgment = await judge_domain(api.state.client, domain, key, safety_threshold, api.state.admission)
        except (TimeoutError, httpx.TimeoutException):
            raise Unavailable(504, "Domain judgment timed out; site was not blocked") from None
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            raise Unavailable(502, "Domain provider unavailable or returned an invalid judgment") from None
        if recording:
            background.add_task(record_domain_judgment, telemetry.prepare_domain_judgment(
                domain, judgment, round((perf_counter() - started) * 1000), safety_threshold, MODEL_VERSION))
        return judgment

    @api.post("/judge-stream")
    async def evaluate_wave(request: Request, background: BackgroundTasks):
        """Avoid browser HTTP/1 connection queuing without holding fast results.

        Each line settles one input batch by index. A failed batch does not erase
        successful siblings; disconnecting cancels outstanding provider work.
        """
        wave = await read_judgment_request(request, Wave)

        async def one(index, batch):
            try:
                result = await evaluate_batch(batch, background)
                return {"index": index, "result": result.model_dump()}
            except Unavailable as error:
                return {"index": index, "error": error.message}

        async def lines():
            tasks = [asyncio.create_task(one(i, batch)) for i, batch in enumerate(wave.batches)]
            try:
                for completed in asyncio.as_completed(tasks):
                    yield json.dumps(await completed) + "\n"
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)

        return StreamingResponse(lines(), media_type="application/x-ndjson", background=background,
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    async def storage_call(function, *args):
        # Storage has its own slots/deadline and stays off the judgment response path.
        if not telemetry.configured():
            raise Unavailable(503, "History recording is not configured")
        try:
            async with asyncio.timeout(8), api.state.storage_slots:
                result = await asyncio.to_thread(function, *args)
            api.state.recording_error = None
            return result
        except (TimeoutError, psycopg.Error, ValueError):
            api.state.recording_error = "History unavailable"
            raise Unavailable(503, "History unavailable; filtering remains active") from None

    async def record_judgments(rows: list[dict]):
        # Send the inference response before database I/O. Report background failures
        # through /health, never as an exception after a successful HTTP response.
        try:
            await storage_call(telemetry.insert_judgments, rows)
        except Unavailable:
            pass

    async def record_domain_judgment(row: dict):
        try:
            await storage_call(telemetry.insert_domain_judgment, row)
        except Unavailable:
            pass

    @api.post("/outcomes")
    async def record_removal(request: Request):
        if not recording:
            raise Unavailable(503, "History recording is not configured")
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

    @api.get("/judgments", dependencies=[Depends(require_token)])
    async def judgment_history(limit: int = Query(default=20, ge=1, le=100), decision: Literal["keep", "remove"] | None = None):
        return {"items": await storage_call(telemetry.recent_judgments, limit, decision)}

    @api.get("/metrics", dependencies=[Depends(require_token)])
    async def metrics():
        return await storage_call(telemetry.metrics)

    return api


load_environment()
app = create_app()

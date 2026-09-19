"""Loopback API. Hosting requires an explicit authentication/deployment boundary."""

import asyncio
from contextlib import asynccontextmanager
import os
import re

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .judge import POLICY_VERSION, judge
from .schemas import Batch


class Unavailable(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


def create_app() -> FastAPI:
    key = os.environ.get("TYPESAFE_API_KEY", "")
    ad_threshold = float(os.environ.get("DENIED_AD_THRESHOLD", "0.70"))
    safety_threshold = float(os.environ.get("DENIED_SAFETY_THRESHOLD", "0.80"))
    max_requests = int(os.environ.get("DENIED_MAX_REQUESTS", "200"))
    if not (0 <= ad_threshold <= 1 and 0 <= safety_threshold <= 1 and max_requests > 0):
        raise ValueError("Invalid thresholds or request budget")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with httpx.AsyncClient(timeout=6, trust_env=False) as connection:
            app.state.client = connection
            app.state.slots = asyncio.Semaphore(2)
            app.state.requests = 0
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
                "requests_remaining": max(0, max_requests - api.state.requests)}

    @api.post("/judge")
    async def evaluate(request: Request):
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 128 * 1024:
                raise Unavailable(413, "Request too large")
        try:
            batch = Batch.model_validate_json(bytes(body))
        except ValidationError:
            raise Unavailable(422, "Invalid judgment request") from None
        if not key:
            raise Unavailable(503, "Set TYPESAFE_API_KEY in the backend environment")

        try:
            # The overall deadline includes queue time. Failed calls also consume the demo budget.
            async with asyncio.timeout(8), api.state.slots:
                if api.state.requests >= max_requests:
                    raise Unavailable(429, "Demo request budget exhausted; restart the API to reset")
                api.state.requests += 1
                return await judge(api.state.client, batch, key, ad_threshold, safety_threshold)
        except (TimeoutError, httpx.TimeoutException):
            raise Unavailable(504, "Judgment timed out; content was not checked") from None
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            # Do not return provider bodies, which can contain supplied page text or credentials.
            raise Unavailable(502, "Provider unavailable or returned an invalid judgment") from None

    return api


app = create_app()

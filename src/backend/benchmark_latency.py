"""Measure real 600-block waves without logging page content or credentials.

Run: uv run --env-file .env python benchmark_latency.py
Uses the production judge, admission and retry path; no substituted responses.
Times include network latency. HTTP event hooks measure attempts independently
of local admission and retry waits. Fixtures are synthetic and not stored in DB.
"""

import asyncio
import argparse
import json
import math
import os
from pathlib import Path
from time import perf_counter

import httpx

from denied.dispatch import Admission
from denied.judge import judge
from denied.schemas import Batch


def percentile(values, fraction):
    return round(sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)], 1)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keepalive-seconds", type=float, default=60,
                        help="Production uses 60; use 5 to reproduce connection-expiry overhead")
    options = parser.parse_args()
    examples = json.loads((Path(__file__).resolve().parent / "tests/cases.json").read_text())
    examples += [dict(text=f"The school garden plot {i} has flowers.", label="", ad=False, unsafe=False)
                 for i in range(20 - len(examples))]
    candidates = [dict(id=str(i), revision=1, text=e["text"], links=e.get("links", []),
                       ad=dict(tag="div", tokens="", label=e["label"], source_host="", known_host=False))
                  for i, e in enumerate(examples)]
    batch = Batch.model_validate(dict(document_id="latency-benchmark", page_host="controlled-example.test",
                                     page_scheme="https", candidates=candidates))
    attempts = []

    async def request_started(request):
        request.extensions["benchmark_started"] = perf_counter()

    async def response_received(response):
        await response.aread()
        attempts.append(dict(status=response.status_code,
                             ms=(perf_counter() - response.request.extensions["benchmark_started"]) * 1000,
                             input_tokens=response.json().get("usage", {}).get("input_tokens", 0)))

    async with httpx.AsyncClient(timeout=15, trust_env=False,
                                limits=httpx.Limits(max_connections=600, max_keepalive_connections=100,
                                                   keepalive_expiry=options.keepalive_seconds),
                                event_hooks={"request": [request_started], "response": [response_received]}) as client:
        gate = Admission()
        key = os.environ["TYPESAFE_API_KEY"]
        await judge(client, batch, key, .70, .80, gate)
        for round_index in range(3):
            await asyncio.sleep(5)
            attempts.clear()
            durations = []
            mismatches = 0
            failures = []

            async def run_one():
                nonlocal mismatches
                started = perf_counter()
                try:
                    result = await judge(client, batch, key, .70, .80, gate)
                    mismatches += sum((r.ad_score >= .70, r.unsafe_score >= .80) != (e["ad"], e["unsafe"])
                                      for r, e in zip(result.results, examples))
                except (httpx.HTTPError, ValueError, KeyError) as error:
                    failures.append(type(error).__name__)
                durations.append((perf_counter() - started) * 1000)

            started = perf_counter()
            await asyncio.gather(*(run_one() for _ in range(30)))
            successful = [a["ms"] for a in attempts if a["status"] == 200]
            print(json.dumps(dict(round=round_index + 1, blocks=600,
                                  wall_ms=round((perf_counter() - started) * 1000),
                                  request_p50_ms=percentile(durations, .5),
                                  request_p95_ms=percentile(durations, .95),
                                  provider_p50_ms=percentile(successful, .5) if successful else None,
                                  provider_p95_ms=percentile(successful, .95) if successful else None,
                                  statuses={str(s): sum(a["status"] == s for a in attempts)
                                            for s in sorted({a["status"] for a in attempts})},
                                  input_tokens=sum(a["input_tokens"] for a in attempts),
                                  mismatches=mismatches, failures=failures)), flush=True)


if __name__ == "__main__":
    asyncio.run(main())

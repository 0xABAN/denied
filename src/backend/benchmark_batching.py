"""Compare real provider calls, without changing the app's singleton dispatch.

Run: uv run --env-file .env python benchmark_batching.py
Controlled short fixtures, three alternating-order rounds; no retries or caching.
Reported request time includes network time, but excludes browser/local API work.
"""

import asyncio
import json
import os
from pathlib import Path
from statistics import median
from time import perf_counter

import httpx

from denied.dispatch import Admission
from denied.judge import ENDPOINT, build_request
from denied.schemas import Batch, Noul


async def main():
    examples = json.loads((Path(__file__).resolve().parent / "tests/cases.json").read_text())
    examples += [dict(name=f"garden {i}", text=f"School garden plot {i} has flowers and butterflies.",
                      label="", ad=False, unsafe=False) for i in range(11)]
    examples.append(dict(name="textless managed ad", text="", label="", ad=True, unsafe=False))
    candidates = [dict(id=str(i), revision=1, text=e["text"], links=e.get("links", []), ad=dict(
        tag="div", tokens="", label=e["label"], source_host="", known_host=False,
        **({"network": "Actirise", "attributes": ["data-actirise"]} if i == 19 else {}),
    )) for i, e in enumerate(examples)]
    batch = Batch.model_validate(dict(document_id="batch-benchmark", page_host="controlled-example.test",
                                     page_scheme="https", candidates=candidates))
    thresholds = [float(os.getenv("DENIED_AD_THRESHOLD", "0.70")),
                  float(os.getenv("DENIED_SAFETY_THRESHOLD", "0.80"))]
    admission = Admission()
    async with httpx.AsyncClient(timeout=45, limits=httpx.Limits(max_connections=20)) as client:
        async def call(items):
            payload = build_request(batch.model_copy(update={"candidates": items}))
            size = len(json.dumps(payload, ensure_ascii=False).encode())
            queued = perf_counter()
            await admission.acquire()
            started = perf_counter()
            try:
                response = await client.post(ENDPOINT, json=payload,
                    headers={"Authorization": f"Bearer {os.environ['TYPESAFE_API_KEY']}"})
                elapsed = (perf_counter() - started) * 1000
                result = dict(blocks=len(items), bytes=size, request_ms=round(elapsed),
                              queue_ms=round((started - queued) * 1000), status=response.status_code)
                if response.status_code != 200:
                    result["error"] = response.text[:1200]
                    return result
                answers = response.json()["answers"]
                assert set(answers) == {f"{kind}_{i}" for i in range(len(items)) for kind in ("ad", "unsafe")}
                decisions = {}
                for i, item in enumerate(items):
                    scores = [Noul.model_validate(answers[f"{kind}_{i}"]).noul for kind in ("ad", "unsafe")]
                    decisions[item.id] = [score >= threshold for score, threshold in zip(scores, thresholds)]
                result["decisions"] = decisions
                return result
            except (httpx.HTTPError, ValueError, KeyError, AssertionError) as error:
                return dict(blocks=len(items), error=type(error).__name__)

        # Warm the connection separately; not included in comparisons.
        warmup = await call(batch.candidates[:1])
        print(json.dumps({"warmup": warmup}), flush=True)
        rounds = []
        for round_index in range(3):
            paired = {}
            for size in ([20, 1] if round_index % 2 == 0 else [1, 20]):
                # Isolate each arm from the previous arm's one-second token window.
                await asyncio.sleep(1.05)
                started = perf_counter()
                calls = await asyncio.gather(*(call(batch.candidates[i:i + size]) for i in range(0, 20, size)))
                wall = round((perf_counter() - started) * 1000)
                decisions = {key: value for result in calls for key, value in result.get("decisions", {}).items()}
                mismatches = [e["name"] for i, e in enumerate(examples)
                              if str(i) in decisions and decisions[str(i)] != [e["ad"], e["unsafe"]]]
                summary = dict(round=round_index + 1, blocks_per_request=size, wall_ms=wall,
                    requests=len(calls), successful_blocks=len(decisions), mismatches=mismatches,
                    median_request_ms=median([r["request_ms"] for r in calls if "request_ms" in r])
                        if any("request_ms" in r for r in calls) else None,
                    payload_bytes=sum(r.get("bytes", 0) for r in calls),
                    first_result_ms=min((r["queue_ms"] + r["request_ms"] for r in calls if "decisions" in r), default=None),
                    max_queue_ms=max((r.get("queue_ms", 0) for r in calls), default=0),
                    errors=[r for r in calls if "error" in r])
                paired[size] = decisions
                rounds.append(summary)
                print(json.dumps(summary), flush=True)
            print(json.dumps({"round": round_index + 1, "disagreements": [key for key in paired[1]
                if key in paired[20] and paired[1][key] != paired[20][key]]}), flush=True)
        print(json.dumps({"summary": [{"blocks_per_request": size,
            "median_wall_ms": median(r["wall_ms"] for r in rounds if r["blocks_per_request"] == size),
            "successful_blocks": sum(r["successful_blocks"] for r in rounds if r["blocks_per_request"] == size),
            "expected_blocks": 60} for size in (1, 20)]}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())

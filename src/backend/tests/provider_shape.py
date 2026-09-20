"""Benchmark real provider question fan-out on a public DOM snapshot from stdin.

No application changes, stored content, fake answers, or weakened policy. Compare
full-page completion, not an average individual response. Scores may change when
questions are separated; report threshold disagreements instead of assuming parity.
"""

import asyncio
import json
import os
import sys
from time import perf_counter
from contextlib import AsyncExitStack

import httpx

from denied.judge import BLOCKS_PER_REQUEST, ENDPOINT, build_request
from denied.schemas import Batch, Noul


def merge_payloads(group):
    """Namespace existing candidate paths and answer IDs without changing policy."""
    first = group[0][1]
    candidates, questions = {}, {}
    for index, payload in group:
        paths = {name: f"group_{index}_{name}" for name in payload["state"]["candidates"]}
        candidates.update({paths[name]: value for name, value in payload["state"]["candidates"].items()})
        for name, question in payload["questions"].items():
            instructions = question["instructions"]
            for old, new in paths.items():
                instructions = instructions.replace(f"candidates.{old}", f"candidates.{new}")
            questions[f"group_{index}_{name}"] = {**question, "instructions": instructions}
    return {**first, "state": {**first["state"], "candidates": candidates}, "questions": questions}


async def main():
    batch = Batch.model_validate(json.load(sys.stdin))
    payloads = [build_request(batch.model_copy(update={"candidates": batch.candidates[i:i + BLOCKS_PER_REQUEST]}))
                for i in range(0, len(batch.candidates), BLOCKS_PER_REQUEST)]
    headers = {"Authorization": f"Bearer {os.environ['TYPESAFE_API_KEY']}"}
    thresholds = {"ad": float(os.environ.get("DENIED_AD_THRESHOLD", "0.70")),
                  "unsafe": float(os.environ.get("DENIED_SAFETY_THRESHOLD", "0.80")),
                  "violent": float(os.environ.get("DENIED_SAFETY_THRESHOLD", "0.80"))}
    transport_experiment = os.environ.get("BENCH_TRANSPORT") == "1"
    large_batch = int(os.environ.get("BENCH_LARGE_BATCH", "0"))
    if large_batch and (large_batch not in (40, 80) or transport_experiment):
        raise ValueError("Large-batch experiment requires 40 or 80 and cannot mix with transport")
    async with AsyncExitStack() as stack:
        clients = {}
        for http2 in ([False, True] if transport_experiment else [False]):
            clients[http2] = await stack.enter_async_context(httpx.AsyncClient(
                timeout=15, trust_env=False, http2=http2,
                limits=httpx.Limits(max_connections=600, max_keepalive_connections=100, keepalive_expiry=60)))
        for round_number in range(1, 4):
            comparisons = {}
            for variant in ([False, True] if round_number % 2 else [True, False]):
                split = variant and not transport_experiment and not large_batch
                client = clients[variant if transport_experiment else False]
                protocols = set()
                calls = []
                for index, payload in enumerate(payloads):
                    if split:
                        for prefix in ("ad_", "unsafe_", "violent_entity_"):
                            calls.append((index, {**payload, "questions": {
                                name: question for name, question in payload["questions"].items()
                                if name.startswith(prefix)}}))
                    else:
                        calls.append((index, payload))
                if large_batch:
                    # Namespace both variants identically so only grouping changes.
                    width = large_batch // BLOCKS_PER_REQUEST if variant else 1
                    indexed = list(enumerate(payloads))
                    calls = [(index, merge_payloads(indexed[index:index + width]))
                             for index in range(0, len(indexed), width)]

                async def send(index, payload):
                    response = await client.post(ENDPOINT, headers=headers, json=payload)
                    response.raise_for_status()
                    protocols.add(response.http_version)
                    answers = response.json()["answers"]
                    if set(answers) != set(payload["questions"]):
                        raise ValueError("Provider response question coverage mismatch")
                    scores = {}
                    for name, value in answers.items():
                        if large_batch:
                            _, source_index, name = name.split("_", 2)
                            key = (int(source_index), name)
                        else:
                            key = (index, name)
                        scores[key] = Noul.model_validate(value).noul
                    return scores, (perf_counter() - started) * 1000

                started = perf_counter()
                responses = await asyncio.gather(*(send(index, payload) for index, payload in calls))
                wall_ms = (perf_counter() - started) * 1000
                scores = {key: score for values, _ in responses for key, score in values.items()}
                comparisons[variant] = scores
                name = ("http2" if variant else "http1") if transport_experiment else ("category-split" if split else "combined")
                if large_batch:
                    name = f"batch-{large_batch if variant else BLOCKS_PER_REQUEST}"
                print(json.dumps({"round": round_number, "shape": name, "protocols": sorted(protocols),
                                  "blocks": len(batch.candidates), "requests": len(calls), "scores": len(scores),
                                  "max_request_bytes": max(len(json.dumps(payload).encode()) for _, payload in calls),
                                  "first_ms": round(min(arrival for _, arrival in responses)),
                                  "all_ms": round(wall_ms)}), flush=True)
            baseline, split_scores = comparisons[False], comparisons[True]
            disagreements = sum((score >= thresholds[name.split("_")[0]]) !=
                                (split_scores[(index, name)] >= thresholds[name.split("_")[0]])
                                for (index, name), score in baseline.items())
            print(json.dumps({"round": round_number, "threshold_disagreements": disagreements,
                              "questions": len(baseline),
                              "mean_absolute_score_change": round(sum(abs(value - split_scores[key])
                                  for key, value in baseline.items()) / len(baseline), 4)}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())

"""Bounded, memory-only exact-evidence reuse before target-specific signing.

One instance belongs to one application lifespan and fixed model/policy/thresholds.
Keys include document identity and page context; reloads and tabs cannot share hits.
Only hashes and unsigned decisions remain after provider work completes.
"""
import asyncio
from collections import OrderedDict
from dataclasses import dataclass
from hashlib import sha256
from time import monotonic
from collections.abc import Awaitable, Callable

from .schemas import Batch, Candidate, Decision, Judgments

Evaluation = Callable[[Batch], Awaitable[tuple[Judgments, int]]]
Value = tuple[Decision, str, int]


@dataclass
class Entry:
    future: asyncio.Future[Value]
    expires: float


class DocumentReuse:
    def __init__(self, capacity: int = 4096, ttl: float = 60):
        self.capacity = capacity
        self.ttl = ttl
        self.entries: OrderedDict[bytes, Entry] = OrderedDict()
        self.tasks: set[asyncio.Task] = set()
        self.hits = 0
        self.misses = 0
        self.requests = 0

    def key(self, batch: Batch, candidate: Candidate) -> bytes:
        evidence = candidate.model_dump_json(exclude={"id", "revision"})
        return sha256((f"{batch.document_id}\0{batch.page_scheme}\0{batch.page_host}\0" + evidence).encode()).digest()

    async def evaluate(self, batch: Batch, evaluate: Evaluation) -> tuple[Judgments, int]:
        now = monotonic()
        for key, entry in list(self.entries.items()):
            if entry.future.done() and entry.expires <= now:
                del self.entries[key]
        keys = [self.key(batch, candidate) for candidate in batch.candidates]
        missing = set(keys) - self.entries.keys()
        # Never evict in-flight work that another caller is sharing. Under load,
        # bypass reuse rather than growing memory or losing valid judgments.
        for key, entry in list(self.entries.items()):
            if len(self.entries) + len(missing) <= self.capacity:
                break
            if entry.future.done() and key not in keys:
                del self.entries[key]
        missing = set(keys) - self.entries.keys()
        if len(self.entries) + len(missing) > self.capacity:
            self.misses += len(batch.candidates)
            self.requests += 1
            return await evaluate(batch)

        selected: list[tuple[Candidate, bytes, Entry]] = []
        waiting: list[Entry] = []
        # No await until every new entry is reserved: concurrent callers see the
        # same future even when their batches have different identities/order.
        for candidate, key in zip(batch.candidates, keys):
            entry = self.entries.get(key)
            if entry is None:
                future = asyncio.get_running_loop().create_future()
                # A disconnected caller may leave nobody to retrieve a failure.
                future.add_done_callback(lambda f: None if f.cancelled() else f.exception())
                entry = Entry(future, float("inf"))
                self.entries[key] = entry
                selected.append((candidate, key, entry))
                self.misses += 1
            else:
                self.hits += 1
                self.entries.move_to_end(key)
            waiting.append(entry)

        if selected:
            async def run():
                try:
                    self.requests += 1
                    subset = batch.model_copy(update={"candidates": [item[0] for item in selected]})
                    judgments, duration = await evaluate(subset)
                    decisions = {decision.id: decision for decision in judgments.results}
                    for candidate, _, entry in selected:
                        decision = decisions[candidate.id].model_copy(deep=True, update={"receipt": None})
                        entry.expires = monotonic() + self.ttl
                        entry.future.set_result((decision, judgments.policy_version, duration))
                except (Exception, asyncio.CancelledError) as error:
                    for _, key, entry in selected:
                        if not entry.future.done():
                            if isinstance(error, asyncio.CancelledError):
                                entry.future.cancel()
                            else:
                                entry.future.set_exception(error)
                        if self.entries.get(key) is entry:
                            del self.entries[key]
                    if isinstance(error, asyncio.CancelledError):
                        raise

            task = asyncio.create_task(run())
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)

        values = await asyncio.gather(*(asyncio.shield(entry.future) for entry in waiting))
        results = [value[0].model_copy(deep=True, update={"id": candidate.id, "revision": candidate.revision, "receipt": None})
                   for candidate, value in zip(batch.candidates, values)]
        return Judgments(document_id=batch.document_id, policy_version=values[0][1], results=results), max(value[2] for value in values)

    async def close(self):
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.entries.clear()

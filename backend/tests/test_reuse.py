"""Reuse checks with genuine Jev judgments; no fabricated model responses."""
import asyncio
import os
import time
import unittest
from datetime import datetime, timezone

import httpx

from denied.judge import judge
from denied.reuse import DocumentReuse
from denied.schemas import Batch
from denied import telemetry
from test_judge import BATCH


class ReuseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = httpx.AsyncClient(timeout=30, trust_env=False)
        self.cache = DocumentReuse()
        self.calls = 0
        self.blocks = 0

    async def asyncTearDown(self):
        await self.cache.close()
        await self.client.aclose()

    async def evaluate(self, batch):
        self.calls += 1
        self.blocks += len(batch.candidates)
        start = time.perf_counter()
        result = await judge(self.client, batch, os.environ["TYPESAFE_API_KEY"], .7, .8)
        return result, round((time.perf_counter() - start) * 1000)

    async def test_concurrent_reuse_rebinds_identity_and_does_not_cross_documents(self):
        first = Batch.model_validate(BATCH)
        second = first.model_copy(deep=True)
        second.candidates[0].id = "2:0"
        second.candidates[0].revision = 2
        (a, ms), (b, _) = await asyncio.gather(
            self.cache.evaluate(first, self.evaluate), self.cache.evaluate(second, self.evaluate))
        self.assertEqual(self.calls, 1)
        self.assertEqual(self.blocks, 1)
        self.assertEqual(b.results[0].id, "2:0")
        self.assertEqual(b.results[0].revision, 2)
        self.assertEqual(a.results[0].ad_score, b.results[0].ad_score)
        self.assertTrue(a.results[0].remove, "Real sales fixture must produce a positive receipt")
        key = "test-receipt-key-not-a-provider-secret" * 2
        telemetry.prepare_judgments(first, a, key, ms, .7, .8, "jev-latest")
        telemetry.prepare_judgments(second, b, key, ms, .7, .8, "jev-latest")
        self.assertNotEqual(a.results[0].receipt, b.results[0].receipt)
        removal = telemetry.Removal(
            document_id=second.document_id, target_id="2", revision=2,
            removed_text=second.candidates[0].text, text_truncated=False,
            date=datetime.now(timezone.utc), total_ms=100,
            passages=[telemetry.Passage(receipt=b.results[0].receipt, text=second.candidates[0].text)])
        self.assertEqual(telemetry.removal_row(removal, key)["target_id"], "2")
        removal.passages[0].receipt = a.results[0].receipt
        with self.assertRaises(ValueError):
            telemetry.removal_row(removal, key)
        cached, cached_ms = await self.cache.evaluate(second, self.evaluate)
        self.assertIsNone(cached.results[0].receipt, "Signed mutable results must not enter shared cache")
        self.assertEqual(cached_ms, ms, "Reused judgments retain their original provider duration")
        self.assertEqual(self.calls, 1)
        second.document_id = "new-document"
        await self.cache.evaluate(second, self.evaluate)
        self.assertEqual(self.calls, 2)
        second.candidates[0].text += " Free delivery."
        await self.cache.evaluate(second, self.evaluate)
        self.assertEqual(self.calls, 3)

    async def test_expiry_capacity_and_changed_context(self):
        await self.cache.close()
        self.cache = DocumentReuse(capacity=1, ttl=60)
        batch = Batch.model_validate(BATCH)
        await self.cache.evaluate(batch, self.evaluate)
        # Force only this entry's expiry, without sleeping or changing the clock.
        next(iter(self.cache.entries.values())).expires = 0
        await self.cache.evaluate(batch, self.evaluate)
        self.assertEqual(self.calls, 2)
        changed = batch.model_copy(deep=True)
        changed.page_host = "different.test"
        await self.cache.evaluate(changed, self.evaluate)
        self.assertEqual(self.calls, 3)
        self.assertLessEqual(len(self.cache.entries), 1)
        await self.cache.evaluate(batch, self.evaluate)
        self.assertEqual(self.calls, 4)

    async def test_within_batch_duplicates_reuse_unsigned_scores(self):
        batch = Batch.model_validate(BATCH)
        second = batch.candidates[0].model_copy(update={"id": "2:0"})
        batch.candidates.append(second)
        result, _ = await self.cache.evaluate(batch, self.evaluate)
        self.assertEqual(self.blocks, 1)
        self.assertEqual([decision.id for decision in result.results], ["1:0", "2:0"])
        self.assertIsNot(result.results[0], result.results[1])

    async def test_canceling_one_waiter_does_not_cancel_another(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def delayed(batch):
            entered.set()
            await release.wait()
            return await self.evaluate(batch)

        batch = Batch.model_validate(BATCH)
        first = asyncio.create_task(self.cache.evaluate(batch, delayed))
        await entered.wait()
        second = asyncio.create_task(self.cache.evaluate(batch, delayed))
        await asyncio.sleep(0)
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        release.set()
        result, _ = await second
        self.assertEqual(len(result.results), 1)
        self.assertEqual(self.calls, 1)

    async def test_failed_real_request_is_not_cached(self):
        batch = Batch.model_validate(BATCH)
        attempts = 0

        async def rejected(batch):
            nonlocal attempts
            attempts += 1
            result = await judge(self.client, batch, "deliberately-invalid-test-key", .7, .8)
            return result, 0

        for _ in range(2):
            with self.assertRaises(httpx.HTTPStatusError):
                await self.cache.evaluate(batch, rejected)
            self.assertEqual(len(self.cache.entries), 0)
        self.assertEqual(attempts, 2)

    async def test_shutdown_cancels_pending_work(self):
        entered = asyncio.Event()

        async def delayed(batch):
            entered.set()
            await asyncio.Event().wait()
            return await self.evaluate(batch)

        request = asyncio.create_task(self.cache.evaluate(Batch.model_validate(BATCH), delayed))
        await entered.wait()
        await self.cache.close()
        with self.assertRaises(asyncio.CancelledError):
            await request
        self.assertEqual(len(self.cache.entries), 0)
        self.assertFalse(self.cache.tasks)

"""Shared admission control for provider requests, including multi-block batches."""

import asyncio
from collections import deque
from time import monotonic


class Admission:
    """Bound request starts across tabs and retries using a rolling minute.

    Provider 429/529 responses govern token-throughput backoff. JSON byte counts
    are not provider token counts and must not silently serialize every wave.
    """

    def __init__(self):
        self.starts: deque[float] = deque()
        self.lock = asyncio.Lock()

    def delay(self, now: float) -> float:
        while self.starts and self.starts[0] <= now - 60:
            self.starts.popleft()
        waits = [0.0]
        if len(self.starts) >= 1200:
            waits.append(self.starts[-1200] + 60 - now)
        return max(waits)

    async def acquire(self) -> None:
        while True:
            async with self.lock:
                now = monotonic()
                wait = self.delay(now)
                if wait <= 0:
                    self.starts.append(now)
                    return
            await asyncio.sleep(wait)

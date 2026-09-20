import { judgmentsFrom, type Batch, type Judgments } from "./contracts";
import { apiBase } from "./settings";

type Pending = {
  batch: Batch;
  done: boolean;
  resolve: (result: Judgments) => void;
  reject: (error: Error) => void;
};
type Queue = { items: Pending[]; bytes: number; timer: ReturnType<typeof setTimeout> };
const queues = new Map<string, Queue>();
const encoder = new TextEncoder();

/** Multiplex independent batches so Chrome's six HTTP/1 sockets do not serialize
 * a wave. Each promise settles as its own NDJSON result arrives, not at EOF.
 * The short collection window groups messages already arriving from one wave.
 */
export function enqueueJudgment(origin: string, batch: Batch): Promise<Judgments> {
  const base = apiBase(origin);
  const bytes = encoder.encode(JSON.stringify(batch)).length + 1;
  let queue = queues.get(base);
  if (queue && (queue.items.length === 30 || queue.bytes + bytes > 1_990_000)) {
    flush(base, queue);
    queue = undefined;
  }
  if (!queue) {
    const next: Queue = { items: [], bytes: 20, timer: setTimeout(() => flush(base, next), 8) };
    queues.set(base, next);
    queue = next;
  }
  const result = new Promise<Judgments>((resolve, reject) => {
    queue!.items.push({ batch, done: false, resolve, reject });
    queue!.bytes += bytes;
  });
  if (queue.items.length === 30) flush(base, queue);
  return result;
}

function flush(base: string, queue: Queue): void {
  clearTimeout(queue.timer);
  if (queues.get(base) === queue) queues.delete(base);
  void deliver(base, queue.items);
}

async function deliver(base: string, items: Pending[]): Promise<void> {
  try {
    const response = await fetch(`${base}/judge-stream`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batches: items.map(item => item.batch) }),
      signal: AbortSignal.timeout(180000), credentials: "omit", redirect: "error", cache: "no-store",
    });
    if (!response.ok || !response.body) throw new Error(`Judgment stream unavailable (${response.status})`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function accept(line: string): void {
      const message = JSON.parse(line);
      if (!Number.isInteger(message.index) || message.index < 0 || message.index >= items.length) {
        throw new Error("Unknown streamed batch");
      }
      const item = items[message.index];
      if (item.done) throw new Error("Duplicate streamed batch");
      if (typeof message.error === "string") {
        item.reject(new Error(message.error.slice(0, 200)));
      } else {
        item.resolve(judgmentsFrom(message.result, item.batch));
      }
      item.done = true;
    }

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line) accept(line);
        }
        if (buffer.length > 1_000_000) throw new Error("Oversized streamed result");
        if (done) break;
      }
      if (buffer.trim()) throw new Error("Truncated judgment stream");
      if (items.some(item => !item.done)) throw new Error("Incomplete judgment stream");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error("Judgment stream failed");
    for (const item of items) if (!item.done) {
      item.done = true;
      item.reject(failure);
    }
  }
}

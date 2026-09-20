import type { Batch, Judgments } from "../contracts";

/** Forward genuine bytes unchanged while observing each result line.
 * Chrome's CDP cache does not reliably retain streamed worker response bodies.
 */
export function observeJudgments<T>(apiURL: string,
  started: (batch: Batch) => T,
  completed: (record: T, status: number, result?: Judgments) => void) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = request.method === "POST" ? await request.text() : undefined;
    const streaming = path === "/judge-stream";
    const observed = streaming || path === "/judge";
    const payload = observed ? JSON.parse(body!) : undefined;
    const records: T[] = observed ? (streaming ? payload.batches : [payload]).map(started) : [];
    const finished = new Set<number>();
    function settle(index: number, status: number, result?: Judgments) {
      if (finished.has(index)) return;
      finished.add(index);
      completed(records[index], status, result);
    }
    try {
      const response = await fetch(`${apiURL}${path}`, {
        method: request.method, headers: request.headers, body, signal: request.signal,
      });
      if (!observed) return response;
      if (!streaming || !response.ok) {
        const text = await response.text();
        const result = response.ok ? JSON.parse(text) : undefined;
        records.forEach((_, index) => settle(index, response.status, result));
        return new Response(text, { status: response.status, headers: response.headers });
      }
      const decoder = new TextDecoder();
      let buffer = "";
      const stream = response.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const message = JSON.parse(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            settle(message.index, message.error ? 502 : 200, message.result);
          }
          controller.enqueue(chunk);
        },
        flush() {
          records.forEach((_, index) => { if (!finished.has(index)) settle(index, 0); });
        },
      }));
      return new Response(stream, { status: response.status, headers: response.headers });
    } catch {
      records.forEach((_, index) => settle(index, 0));
      return new Response("Real API unavailable", { status: 502 });
    }
  } });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

/** Measure browser transport concurrency while forwarding genuine API responses. */
import assert from "node:assert/strict";
import { launchExtension } from "./browser";
import { localAPI, until } from "./api";

const api = await localAPI();
let active = 0;
let peak = 0;
let completedBlocks = 0;
const timings: { start: number; end: number; status: number }[] = [];
const resultTimes: number[] = [];
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const start = performance.now();
  active++;
  peak = Math.max(peak, active);
  try {
    const input = await request.text();
    const payload = JSON.parse(input);
    const response = await fetch(`${api.url}${new URL(request.url).pathname}`, {
      method: request.method, headers: { "Content-Type": "application/json" }, body: input,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: ArrayBuffer[] = [];
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (value) chunks.push(new Uint8Array(value).buffer);
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = JSON.parse(buffer.slice(0, newline));
        assert.ok(line.result && !line.error, "every streamed provider batch succeeds");
        assert.equal(line.result.results.length, 20);
        assert.ok(line.result.results.every((result: { remove: boolean }) => !result.remove));
        resultTimes.push(performance.now() - start);
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
    const body = new Blob(chunks);
    timings.push({ start, end: performance.now(), status: response.status });
    completedBlocks += payload.batches
      ? payload.batches.reduce((sum: number, batch: { candidates: unknown[] }) => sum + batch.candidates.length, 0)
      : payload.candidates.length;
    return new Response(body, { status: response.status, headers: { "Content-Type": "application/json" } });
  } finally {
    active--;
  }
} });
const site = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
  return new Response(`<html><body>${Array.from({ length: 600 }, (_, i) =>
    `<p>School garden ${i} has flowers and butterflies.</p>`).join("")}</body></html>`,
    { headers: { "Content-Type": "text/html" } });
} });
const extension = await launchExtension({ enabled: true, animate: false, toast: false, apiBase: `http://127.0.0.1:${proxy.port}` });
const { context } = extension;
try {
  const page = await context.newPage();
  for (let round = 1; round <= 3; round++) {
    timings.length = 0;
    resultTimes.length = 0;
    completedBlocks = 0;
    peak = 0;
    await page.goto(`http://127.0.0.1:${site.port}/?round=${round}`);
    await until(() => completedBlocks === 600, "600 blocks finish through real API", 60000);
    assert.ok(timings.every(t => t.status === 200));

    const first = Math.min(...timings.map(t => t.start));
    const durations = timings.map(t => t.end - t.start).sort((a, b) => a - b);
    resultTimes.sort((a, b) => a - b);
    console.log(JSON.stringify({ round, peakBackendRequests: peak,
      startSpreadMs: Math.round(Math.max(...timings.map(t => t.start)) - first),
      wallMs: Math.round(Math.max(...timings.map(t => t.end)) - first),
      requestP50Ms: Math.round(durations[Math.floor((durations.length - 1) * .5)]),
      requestP95Ms: Math.round(durations[Math.floor((durations.length - 1) * .95)]),
      firstBatchMs: Math.round(resultTimes[0]), batchP50Ms: Math.round(resultTimes[14]),
      batchP95Ms: Math.round(resultTimes[28]) }));
    assert.equal(timings.length, 1, "600 short blocks should share one streaming transport request");
    assert.equal(resultTimes.length, 30);
    if (round < 3) await Bun.sleep(5000);
  }
} finally {
  await extension.close();
  proxy.stop(true);
  site.stop(true);
  await api.stop();
}

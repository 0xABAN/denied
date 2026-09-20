/** Live YouTube + installed extension + real Jev. Proxy forwards chunks immediately.
 * Animation is disabled only in this isolated profile. No personal Chrome data.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { localAPI, until } from "./api";

const api = await localAPI({ DENIED_DOCUMENT_REUSE: process.env.DENIED_DOCUMENT_REUSE || "1" });
const profile = await mkdtemp(join(tmpdir(), "noped-youtube-bench-"));
let events: { start: number; arrival: number; blocks: number; error: boolean }[] = [];
let starts: number[] = [];
let evidenceKeys = new Set<string>();
let revisionKeys = new Set<string>();
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const start = performance.now();
  starts.push(start);
  const body = await request.text();
  const payload = JSON.parse(body);
  for (const batch of payload.batches) for (const candidate of batch.candidates) {
    const { id, revision, ...evidence } = candidate;
    evidenceKeys.add(String(Bun.hash(JSON.stringify(evidence))));
    revisionKeys.add(`${batch.document_id}:${id}:${revision}`);
  }
  const response = await fetch(`${api.url}${new URL(request.url).pathname}`, {
    method: request.method, headers: { "Content-Type": "application/json" }, body,
    signal: AbortSignal.timeout(60000),
  });
  assert(response.ok && response.body, `API status ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (value) controller.enqueue(value);
        buffer += decoder.decode(value, { stream: !done });
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          events.push({ start, arrival: performance.now(), blocks: payload.batches[line.index].candidates.length,
            error: !!line.error });
        }
        if (done) controller.close();
      } catch (error) { controller.error(error); }
    },
    cancel() { return reader.cancel(); },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
} });
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${resolve("dist")}`, `--load-extension=${resolve("dist")}`],
});
const rows: object[] = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await until(() => worker.evaluate(async () => !!(await chrome.storage.local.get("automaticDefaultsApplied")).automaticDefaultsApplied), "settings initialization");
  await worker.evaluate(async apiBase => {
    await chrome.storage.local.set({ settings: { enabled: true, animate: false, mode: "remove", apiBase } });
  }, `http://127.0.0.1:${proxy.port}`);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  for (let round = 1; round <= Number(process.env.BENCH_ROUNDS || 3); round++) {
    const healthBefore = await fetch(`${api.url}/health`).then(response => response.json());
    events = [];
    starts = [];
    evidenceKeys = new Set();
    revisionKeys = new Set();
    await cdp.send("Profiler.start");
    const navigationStart = performance.now();
    await page.goto("https://www.youtube.com/results?search_query=black+ops+7", { waitUntil: "domcontentloaded", timeout: 30000 });
    let stats: any;
    const settledStart = performance.now();
    try {
      await until(async () => {
        stats = await worker.evaluate(async () => {
          // This isolated profile has one active benchmark tab. Reading URLs
          // would require tabs/host permission the production extension lacks.
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) return null;
          return chrome.tabs.sendMessage(tab.id, { type: "pageStats", debug: true }, { frameId: 0 }).catch(() => null);
        });
        return events.length > 0 && !stats?.debug?.busy && stats?.debug?.roots === 0 && stats?.pending === 0 &&
          performance.now() - events.at(-1)!.arrival > 1000;
      }, "YouTube initial workload settles", 30000);
    } catch { /* Report pending/deferred work rather than treating timeout as success. */ }
    const { profile: cpu } = await cdp.send("Profiler.stop");
    const nodes = new Map(cpu.nodes.map(node => [node.id, node.callFrame]));
    const selfTime = new Map<string, number>();
    cpu.samples?.forEach((id, index) => {
      const frame = nodes.get(id);
      if (!frame?.url.startsWith("chrome-extension://")) return;
      const name = frame.functionName || "(anonymous)";
      selfTime.set(name, (selfTime.get(name) || 0) + (cpu.timeDeltas?.[index] || 0) / 1000);
    });
    const first = Math.min(...starts);
    const arrivals = events.map(event => event.arrival - event.start).sort((a, b) => a - b);
    const health = await fetch(`${api.url}/health`).then(response => response.json());
    const reuse = health.document_reuse;
    const documentReuse = reuse ? { enabled: reuse.enabled,
      hits: reuse.hits - healthBefore.document_reuse.hits,
      misses: reuse.misses - healthBefore.document_reuse.misses,
      inference_batches: reuse.inference_batches - healthBefore.document_reuse.inference_batches } : null;
    const row = { round, title: await page.title(), documentReuse, streams: starts.length, deliveredBatches: events.length,
      submittedBlocks: events.reduce((sum, event) => sum + event.blocks, 0), errors: events.filter(event => event.error).length,
      uniqueEvidence: evidenceKeys.size, uniqueRevisions: revisionKeys.size,
      firstDispatchAfterNavigationMs: Math.round(first - navigationStart),
      firstResultMs: events.length ? Math.round(Math.min(...events.map(event => event.arrival)) - first) : null,
      lastResultMs: events.length ? Math.round(Math.max(...events.map(event => event.arrival)) - first) : null,
      batchP50Ms: arrivals[Math.floor(arrivals.length / 2)],
      observedMs: Math.round(performance.now() - settledStart), stats,
      extensionCpuTop: [...selfTime].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, ms]) => ({ name, ms: Math.round(ms) })) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
} finally {
  await context.close();
  proxy.stop(true);
  await api.stop();
  await rm(profile, { recursive: true, force: true });
  await mkdir("artifacts", { recursive: true });
  await Bun.write(`artifacts/youtube-extension-latency-${Date.now()}.json`, JSON.stringify(rows, null, 2));
}

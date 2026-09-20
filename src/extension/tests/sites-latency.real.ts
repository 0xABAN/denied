/** Public live pages, production scanner and genuine Jev calls. No mock judgments.
 * Measures a settled DOM snapshot, not navigation time or the animation tail.
 * Saves aggregate timings only; history recording is disabled by localAPI.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { localAPI } from "./api";
import { judgmentsFrom, type Batch, type Candidate } from "../contracts";

const sites: Record<string, string> = {
  youtube: "https://www.youtube.com/results?search_query=black+ops+7",
  speedtest: "https://www.speedtest.net/",
  reddit: "https://www.reddit.com/r/science/",
  wikipedia: "https://en.wikipedia.org/wiki/Solar_System",
};
const selected = process.argv.slice(2);
const batchSizes = (process.env.BENCH_BATCH_SIZES || "20,10").split(",").map(Number);
const rounds = Number(process.env.BENCH_ROUNDS || 3);
assert(batchSizes.every(size => Number.isInteger(size) && size >= 1 && size <= 20));
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10);
assert(selected.every(site => site in sites), "Unknown benchmark site");
const bundle = await Bun.build({ entrypoints: ["src/extension/scan.ts"], target: "browser", format: "esm" });
assert(bundle.success);
const script = await bundle.outputs[0].text();
const api = await localAPI();
const browser = await chromium.launch({ channel: "chromium", headless: true });
const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 1000 } });
const rows: object[] = [];
const percentile = (values: number[], p: number) => Math.round([...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] || 0);
try {
  for (const [site, url] of Object.entries(sites).filter(([id]) => !selected.length || selected.includes(id))) {
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Let live hydration complete before taking a fixed workload snapshot.
      // This stabilization time is explicitly excluded, not claimed as processing.
      await page.waitForTimeout(3000);
      const snapshot = await page.evaluate(async script => {
        const moduleURL = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
        const scan = await import(moduleURL);
        URL.revokeObjectURL(moduleURL);
        const start = performance.now();
        const elements = scan.discover(document.body) as HTMLElement[];
        const discovered = performance.now();
        const candidates = elements.map((element, index) => {
          const value = scan.evidence(element);
          return { id: String(index), revision: 1, text: value.text, links: value.links, ad: value.ad };
        });
        return { candidates, discoveryMs: discovered - start, evidenceMs: performance.now() - discovered,
          host: location.hostname, title: document.title,
          youtubeCards: document.querySelectorAll("ytd-video-renderer,ytd-rich-item-renderer").length };
      }, script);
      const candidates = snapshot.candidates as Candidate[];
      console.log(JSON.stringify({ site, stage: "scan", status: response?.status(), blocks: candidates.length,
        discoveryMs: Math.round(snapshot.discoveryMs), evidenceMs: Math.round(snapshot.evidenceMs),
        title: snapshot.title, youtubeCards: snapshot.youtubeCards }));
      if (!response?.ok() || !candidates.length || /prove your humanity|just a moment|access denied/i.test(snapshot.title) ||
          (site === "youtube" && !snapshot.youtubeCards)) {
        rows.push({ site, unavailable: true, status: response?.status(), title: snapshot.title });
        continue;
      }
      // Do not silently truncate a large page and claim whole-page completion.
      if (candidates.length > 6000) {
        rows.push({ site, blocks: candidates.length, skipped: "Over 6000 blocks; requires a separate bounded load run" });
        continue;
      }
      if (process.env.BENCH_PROVIDER_SHAPES === "1") {
        const experiment = Bun.spawn(["uv", "run", "--env-file", ".env", "--with", "httpx[http2]", "python", "-m", "tests.provider_shape"], {
          cwd: "backend", stdin: new Response(JSON.stringify({ document_id: `shape-${site}`,
            page_host: snapshot.host, page_scheme: "https", candidates })), stdout: "pipe", stderr: "inherit",
        });
        const output = await new Response(experiment.stdout).text();
        console.log(output.trim());
        rows.push(...output.trim().split("\n").filter(Boolean).map(line => ({ site,
          discoveryMs: snapshot.discoveryMs, evidenceMs: snapshot.evidenceMs,
          scope: "Direct provider experiment; excludes backend and extension messaging", ...JSON.parse(line) })));
        assert.equal(await experiment.exited, 0, "Real provider shape experiment failed");
        continue;
      }
      for (let round = 1; round <= rounds; round++) {
        // Alternate ordering so every smaller-batch trial is not automatically
        // advantaged by running after all baseline trials have warmed connections.
        for (const batchSize of round % 2 ? batchSizes : [...batchSizes].reverse()) {
          const started = performance.now();
          const batches: Batch[] = [];
          for (let i = 0; i < candidates.length; i += batchSize) batches.push({
            document_id: `${site}-${batchSize}-${round}`, page_host: snapshot.host, page_scheme: "https",
            candidates: candidates.slice(i, i + batchSize),
          });
          const arrivals: number[] = [];
          let checked = 0;
          const errors: string[] = [];
          // Match the worker's maximum 30 batches per streaming request.
          await Promise.all(Array.from({ length: Math.ceil(batches.length / 30) }, async (_, wave) => {
            const group = batches.slice(wave * 30, wave * 30 + 30);
            const response = await fetch(`${api.url}/judge-stream`, { method: "POST",
              headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batches: group }),
              signal: AbortSignal.timeout(60000) });
            if (!response.ok || !response.body) throw new Error(`API ${response.status}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            const seen = new Set<number>();
            for (;;) {
              const { value, done } = await reader.read();
              buffer += decoder.decode(value, { stream: !done });
              let end: number;
              while ((end = buffer.indexOf("\n")) >= 0) {
                const line = JSON.parse(buffer.slice(0, end));
                buffer = buffer.slice(end + 1);
                assert(Number.isInteger(line.index) && group[line.index] && !seen.has(line.index));
                seen.add(line.index);
                if (line.error) errors.push(line.error);
                else {
                  checked += judgmentsFrom(line.result, group[line.index]).results.length;
                  arrivals.push(performance.now() - started);
                }
              }
              if (done) break;
            }
            assert(!buffer.trim() && seen.size === group.length, "Incomplete stream");
          }));
          const wallMs = performance.now() - started;
          const row = { site, batchSize, round, blocks: candidates.length, requests: batches.length, checked,
            discoveryMs: Math.round(snapshot.discoveryMs), evidenceMs: Math.round(snapshot.evidenceMs),
            firstMs: Math.round(Math.min(...arrivals)), p50Ms: percentile(arrivals, .5), p95Ms: percentile(arrivals, .95),
            wallMs: Math.round(wallMs), snapshotToAllMs: Math.round(snapshot.discoveryMs + snapshot.evidenceMs + wallMs), errors };
          rows.push(row);
          console.log(JSON.stringify(row));
        }
      }
    } catch (error) {
      const row = { site, error: error instanceof Error ? error.message : String(error) };
      rows.push(row);
      console.log(JSON.stringify(row));
    } finally { await page.close(); }
  }
} finally {
  await context.close();
  await browser.close();
  await api.stop();
  await mkdir("artifacts", { recursive: true });
  await Bun.write(`artifacts/sites-latency-${selected.join("-") || "all"}-${Date.now()}.json`, JSON.stringify({ at: new Date().toISOString(),
    scope: "Settled public DOM snapshots; actual scanner and Jev; excludes navigation, extension messaging, animation and history persistence", rows }, null, 2));
}

/** Real Chrome -> forwarding observer -> FastAPI -> Jev; no substituted responses. */
import assert from "node:assert/strict";
import { launchExtension } from "./browser";
import { localAPI, until } from "./api";
import { observeJudgments } from "./observe-judgments";

const api = await localAPI();
const blockCount = process.argv.includes("--dynamic-only") ? 5 : 605;
const site = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
  return new Response(`<html><body>${Array.from({ length: blockCount }, (_, i) =>
    `<p id="ordinary-${i}">School garden number ${i} has flowers and butterflies.</p>`).join("")}
    <sample-card id="sponsor"></sample-card><script>
    document.querySelector('sample-card').attachShadow({mode:'open'}).innerHTML =
      '<div><span>Sponsored</span><h2>Buy our colored pencils today.</h2><a href="https://example.com">Shop now</a></div>';
    </script></body></html>`, { headers: { "Content-Type": "text/html" } });
} });
const requests: { at: number; count: number }[] = [];
const statuses: number[] = [];
let completedBlocks = 0;
let firstWaveCompletedAt: number | undefined;
const observer = observeJudgments(api.url, batch => {
  const record = { at: performance.now(), count: batch.candidates.length };
  requests.push(record);
  return record;
}, (record, status) => {
    statuses.push(status);
    if (statuses.length === 30) firstWaveCompletedAt = performance.now();
    completedBlocks += record.count;
});
const extension = await launchExtension({ enabled: true, animate: false, apiBase: observer.url });
const { context } = extension;
try {
  const page = await context.newPage();
  const started = performance.now();
  await page.goto(`http://127.0.0.1:${site.port}/`);
  await until(() => completedBlocks >= blockCount + 1, "real batched judgments", 180000);
  await until(async () => await page.locator("#sponsor").count() === 0, "whole shadow card removed", 15000);
  assert(requests.every(r => r.count >= 1 && r.count <= 20), "Each provider batch must contain at most twenty blocks");
  assert.equal(requests.length, Math.ceil((blockCount + 1) / 20));
  assert(requests[0].at - started < 2000, "First inference should start without the five-second startup delay");
  if (blockCount > 600) assert(requests[30].at - requests[0].at < 4900, "Second wave must not wait five seconds");
  assert(statuses.every(status => status === 200), JSON.stringify({ statuses }));
  assert.equal(await page.locator('p[id^="ordinary-"]').count(), blockCount, "Ordinary content was removed");
  const beforeLate = statuses.length;
  await page.evaluate(() => {
    const card = document.createElement("sample-card");
    card.id = "late";
    card.attachShadow({ mode: "open" }).innerHTML = "<p>The school garden has flowers.</p>";
    document.body.append(card);
  });
  await until(() => statuses.length > beforeLate, "late card checked", 20000);
  assert.equal(await page.locator("#late").count(), 1);
  await page.evaluate(() => {
    document.querySelector("#late")!.shadowRoot!.innerHTML = "<p>Sponsored. Buy our colored pencils today.</p>";
  });
  await until(async () => await page.locator("#late").count() === 0, "shadow-only mutation rechecked", 20000);
  const beforeMedia = completedBlocks;
  await page.evaluate(() => {
    const ad = document.createElement("iframe");
    ad.id = "media-placement";
    ad.src = "about:blank";
    ad.setAttribute("data-actirise", "");
    const benign = document.createElement("iframe");
    benign.id = "ordinary-frame";
    benign.src = "about:blank";
    document.body.append(ad, benign);
  });
  await until(() => completedBlocks >= beforeMedia + 2, "textless media reaches Jev", 20000);
  await until(async () => await page.locator("#media-placement").count() === 0, "textless ad removed", 15000);
  assert.equal(await page.locator("#ordinary-frame").count(), 1, "Benign iframe was removed");
  console.log(JSON.stringify({ passed: true, requests: requests.length, maxBlocksPerRequest: 20,
    initialDelayMs: Math.round(requests[0].at - started),
    firstWaveResponseMs: firstWaveCompletedAt ? Math.round(firstWaveCompletedAt - requests[0].at) : null,
    secondWaveMs: requests[30] ? Math.round(requests[30].at - requests[0].at) : null,
    shadowCardRemoved: true, shadowMutationRemoved: true, textlessMediaChecked: true }));
} finally {
  await extension.close();
  observer.stop();
  site.stop(true);
  await api.stop();
}

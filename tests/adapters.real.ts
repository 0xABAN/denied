/** Real built extension -> FastAPI -> Jev, on explicitly SYNTHETIC site layouts.
 * Browser-only DNS mapping sends the fixture hostnames to our actual HTTPS test
 * server. No page routes or classifier responses are intercepted/substituted.
 * This proves integration, not live-site compatibility or authenticated coverage.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { judgmentsFrom, type Batch, type Judgments, type PageStats } from "../extension/src/contracts";
import { adapterFixtures, fixturePage } from "./adapters.fixtures";
import { localAPI, until } from "./api";
import { observeJudgments } from "./observe-judgments";

const profile = await mkdtemp(join(tmpdir(), "denied-adapters-"));
const key = join(profile, "fixture.key");
const cert = join(profile, "fixture.crt");
const openssl = Bun.spawn(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-subj", "/CN=denied-controlled-fixtures", "-keyout", key, "-out", cert], { stdout: "ignore", stderr: "ignore" });
assert.equal(await openssl.exited, 0, "openssl must create an isolated test certificate");
const api = await localAPI();
const observations: { batch: Batch; status?: number; result?: Judgments }[] = [];
const observer = observeJudgments(api.url, batch => {
  const record = { batch } as typeof observations[number];
  observations.push(record);
  return record;
}, (record, status, result) => Object.assign(record, { status, result }));
let localRequests = 0;
const watch = `<!doctype html><html><head><title>denied adapter fixture</title><style>
  ytd-watch-flexy {display:block} video {width:240px;height:120px}
  </style></head><body><nav id="navigation">Navigation</nav><ytd-watch-flexy id="watch">
  <div id="player-container-outer"><video muted></video></div>
  <ytd-watch-metadata><div id="above-the-fold"><div id="title"><h1>Hardcore pornography for adults only</h1></div></div><div id="description">Explicit adult video.</div></ytd-watch-metadata>
  <div id="comments"><p>The school garden has flowers and butterflies.</p></div>
  <div id="related"><p>A gentle nature documentary for children.</p></div></ytd-watch-flexy>
  <form id="composer"><textarea>DO_NOT_SEND_DRAFT</textarea></form>
  <script>const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
  const stream=canvas.captureStream(1);window.video=document.querySelector('video');window.video.srcObject=stream;
  canvas.getContext('2d').fillRect(0,0,2,2);window.started=window.video.play();</script></body></html>`;
const site = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: { key: Bun.file(key), cert: Bun.file(cert) }, fetch(request) {
  const url = new URL(request.url);
  const fixture = adapterFixtures.find(fixture => new URL(fixture.url).hostname === url.hostname);
  if (!fixture) return new Response(null, { status: 404 });
  localRequests++;
  let html = fixture.site === "youtube" && url.pathname === "/watch" ? watch : fixturePage(fixture);
  // No graphic wording: entity knowledge must identify this complete video card.
  if (fixture.site === "youtube" && url.pathname !== "/watch") html = html.replace("Tickets for sale. Send me a message to buy them for $40.", "Black Ops 7");
  // The tiny badge, not a sales pitch in the body, must identify the whole X post.
  if (fixture.site === "x") html = html.replace("Tickets for sale. Send me a message to buy them for $40.", "The school garden has flowers and butterflies.");
  return new Response(html, { headers: { "Content-Type": "text/html" } });
} });
const mappings = [...new Set(adapterFixtures.map(fixture => new URL(fixture.url).hostname))]
  .map(host => `MAP ${host} 127.0.0.1`).join(", ");
let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
try {
  context = await chromium.launchPersistentContext(join(profile, "chrome"), {
    channel: "chromium", headless: true, ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${resolve("dist")}`, `--load-extension=${resolve("dist")}`,
      `--host-resolver-rules=${mappings}`, "--no-proxy-server"],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  await worker.evaluate(async apiBase => {
    await chrome.storage.local.set({ settings: { enabled: true, animate: false, toast: false, mode: "remove", apiBase } });
  }, observer.url);
  const page = await context.newPage();
  async function navigate(url: URL) {
    url.port = String(site.port);
    const before = localRequests;
    await page.goto(url.href);
    assert.equal(await page.title(), "denied adapter fixture", "Never run fixture removals on a real site's page");
    assert(localRequests > before, "Browser must reach our actual local fixture server");
    // The extension intentionally lacks tabs permission: external-page URLs
    // are redacted by Chrome. Select our foreground tab without adding access.
    await page.bringToFront();
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
    assert(tabId !== undefined, "Controlled foreground tab must exist");
    return (): Promise<PageStats> => worker.evaluate(id => chrome.tabs.sendMessage(id, { type: "pageStats" }), tabId);
  }

  for (const fixture of adapterFixtures) {
    const before = observations.length;
    const stats = await navigate(new URL(fixture.url));
    await until(async () => await page.locator('[data-fixture="target"]').count() === 0, `${fixture.site}: complete item removed by real Jev`, 30000);
    await until(async () => (await stats()).pending === 0, `${fixture.site}: judgments settled`);
    assert.equal(await page.locator('[data-fixture="neighbor"]').count(), 1, `${fixture.site}: neighbor must remain`);
    for (const id of ["navigation", "composer"]) assert.equal(await page.locator(`#${id}`).count(), 1);
    assert.equal((await stats()).total, 1, `${fixture.site}: count once per logical item`);
    const judgments = observations.slice(before).flatMap(record => record.result?.results || []);
    const reason = fixture.site === "youtube" ? "unsafe_content" : "advertising";
    assert(judgments.some(result => result.reasons.includes(reason)), `${fixture.site}: require actual ${reason} judgment`);
    assert(judgments.some(result => !result.remove), `${fixture.site}: require actual keep judgment`);
    if (fixture.site === "youtube") {
      assert(judgments.some(result => result.remove && result.violent_entity_score >= 0.80));
      assert.equal((await stats()).unsafe_content, 1, "Entity judgment counts once under the existing safety filter");
      const observed = observations.slice(before).find(record => record.result)!;
      // Validate malformed copies at the parser boundary, never feed substituted
      // responses into the extension or replace the actual inference service.
      for (const score of [undefined, null, -0.1, 1.1, NaN, Infinity, "0.9", true]) {
        const invalid: any = structuredClone(observed.result);
        invalid.results[0].violent_entity_score = score;
        assert.throws(() => judgmentsFrom(invalid, observed.batch), "Third score must be present and finite in [0, 1]");
      }
    }
    console.log(`PASS: ${fixture.site} synthetic layout, real provider, whole item removed and neighbor preserved`);
  }

  const stats = await navigate(new URL("https://www.youtube.com/watch?v=example"));
  await page.evaluate(() => (window as any).started);
  await until(async () => await page.locator("#above-the-fold").count() === 0, "watch metadata and player removed", 30000);
  assert.equal(await page.locator("#player-container-outer").count(), 0);
  assert.equal(await page.evaluate(() => (window as any).video.paused), true);
  for (const id of ["watch", "comments", "related", "composer", "navigation"]) assert.equal(await page.locator(`#${id}`).count(), 1);
  assert.equal((await stats()).total, 1, "Disjoint watch regions count as one removal");
  assert(observations.every(record => record.status === 200), "Every real provider request must succeed");
  const payloads = JSON.stringify(observations.map(record => record.batch));
  for (const excluded of ["DO_NOT_SEND", "ownership_revision", "media_revisions", "data-message-id", "data-legacy-message-id"]) {
    assert(!payloads.includes(excluded), `${excluded} must remain browser-local`);
  }
  console.log("PASS: watch-page multi-region removal, native playback pause, preserved comments and payload privacy");
} finally {
  await context?.close();
  site.stop(true);
  observer.stop();
  await api.stop();
  await rm(profile, { recursive: true, force: true });
}

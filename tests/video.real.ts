/** Actual extension -> FastAPI -> Jev metadata filtering; no inspected video pixels. */
import assert from "node:assert/strict";
import { launchExtension } from "./browser";
import type { Batch, Judgments, PageStats } from "../extension/src/contracts";
import { localAPI, until } from "./api";
import { observeJudgments } from "./observe-judgments";

const api = await localAPI();
const observations: { batch: Batch; status?: number; result?: Judgments }[] = [];
const observer = observeJudgments(api.url, batch => {
  const record = { batch } as typeof observations[number];
  observations.push(record);
  return record;
}, (record, status, result) => Object.assign(record, { status, result }));
const site = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  if (new URL(request.url).pathname !== "/") return new Response(null, { status: 404 });
  return new Response(`<html><head><style>
    video { width: 220px; height: 100px } img { width: 90px; height: 50px }
  </style></head><body><main>
    <div id="explicitplayer"><video muted></video><div><h2>Explicit pornography for adults only</h2>
      <p>Uncensored footage of sexual intercourse.</p></div></div>
    <div id="dangerouslisting"><a href="/watch/DO_NOT_SEND?token=DO_NOT_SEND"><img alt="Video preview"></a>
      <h3><a href="/watch/DO_NOT_SEND?token=DO_NOT_SEND">A new challenge</a></h3>
      <p>Step-by-step instructions for the choking challenge. Try choking yourself until you pass out.</p></div>
    <div id="education"><video preload="none" src="/DO_NOT_SEND.mp4"></video><h2>Understanding puberty</h2>
      <p>A non-graphic, age-appropriate health lesson for children about growing up.</p></div>
    <div id="neighbor"><a href="/watch/nature"><img alt="Bird video preview"></a>
      <h3><a href="/watch/nature">Birds in the school garden</a></h3><p>An introduction to local birds.</p></div>
    <video id="titleonly" title="Hardcore pornography for adults only"></video>
    <video id="prevention" title="Online safety: age-appropriate advice for children to avoid pornography"></video>
    <video id="changing" title="Birds in the school garden" aria-description="Learn about local birds."></video>
    <video id="unknown"></video>
    <p id="ordinary">The library reading group meets on Saturday.</p>
    <input value="DO_NOT_SEND_INPUT"><div contenteditable>DO_NOT_SEND_DRAFT</div>
  </main><script>
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    const stream = canvas.captureStream(1);
    window.playingVideo = document.querySelector('#explicitplayer video');
    window.playingVideo.srcObject = stream;
    canvas.getContext('2d').fillRect(0, 0, 2, 2);
    window.playbackStarted = window.playingVideo.play();
  </script></body></html>`, { headers: { "Content-Type": "text/html" } });
} });
const extension = await launchExtension({ enabled: true, animate: false, toast: false, apiBase: observer.url });
const { context, worker } = extension;
try {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${site.port}/`);
  await page.evaluate(() => (window as any).playbackStarted);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url)!.id!, page.url());
  const stats = (): Promise<PageStats> => worker.evaluate(id => chrome.tabs.sendMessage(id, { type: "pageStats" }), tabId);
  const forTarget = (id: string) => observations.flatMap(record => record.batch.candidates
    .filter(candidate => candidate.ad.tokens.split(" ").includes(id))
    .map(candidate => ({ candidate, decision: record.result?.results.find(result => result.id === candidate.id) })));

  for (const id of ["explicitplayer", "dangerouslisting", "titleonly"]) {
    await until(async () => await page.locator(`#${id}`).count() === 0, `${id} removed from real metadata judgment`, 40000);
    assert(forTarget(id).some(record => record.decision?.reasons.includes("unsafe_content")), `${id} must have a genuine unsafe-content judgment`);
  }
  await until(async () => (await stats()).pending === 0, "initial metadata judgments settled");
  for (const id of ["education", "prevention", "neighbor", "changing", "unknown", "ordinary"]) {
    assert.equal(await page.locator(`#${id}`).count(), 1, `${id} must remain`);
    assert(forTarget(id).some(record => record.decision && !record.decision.remove), `${id} must have a genuine keep judgment`);
  }
  assert.equal(await page.evaluate(() => (window as any).playingVideo.paused), true, "Native playback stops before removal");
  assert.equal((await stats()).total, 3);
  assert.equal((await stats()).deferred, 1, "The unlabeled player's contents remain unchecked");

  const beforeSourceChange = forTarget("education").length;
  await page.locator("#education video").evaluate(el => el.setAttribute("src", "/DO_NOT_SEND-replacement.mp4?token=DO_NOT_SEND"));
  await until(() => forTarget("education").length > beforeSourceChange && Boolean(forTarget("education").at(-1)?.decision), "same-host source mutation rejudged", 20000);
  assert.equal(await page.locator("#education").count(), 1);

  await page.locator("#changing").evaluate(el => {
    el.setAttribute("aria-description", "Explicit pornography: uncensored footage of sexual intercourse.");
  });
  await until(async () => await page.locator("#changing").count() === 0, "description-only attribute mutation rejudged", 20000);
  assert(forTarget("changing").some(record => record.candidate.text.includes("Media description:") && record.decision?.remove));
  assert.equal((await stats()).total, 4);
  assert(observations.every(record => record.status === 200), "All real provider requests must succeed");
  assert(!JSON.stringify(observations.map(record => record.batch)).includes("DO_NOT_SEND"), "Private fields and media URL paths/query strings must not leave the browser");
  assert(!observations.some(record => record.batch.candidates.some(candidate => "media_revisions" in candidate)), "Local identity tokens stay out of API payloads");
  console.log("PASS: real Jev metadata removals, educational/neighbor preservation, unknown status, playback pause, source/description mutations, and URL privacy");
} finally {
  await extension.close();
  observer.stop();
  site.stop(true);
  await api.stop();
}

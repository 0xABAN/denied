/** Real browser checks for metadata association and playback; no classifier substitutions. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const bundles = await Promise.all(["scan", "effects"].map(async name => {
  const bundle = await Bun.build({ entrypoints: [`extension/src/${name}.ts`], target: "browser", format: "esm" });
  assert(bundle.success);
  return [name, await bundle.outputs[0].text()] as const;
}));
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>video, iframe { width: 240px; height: 120px } img { width: 100px; height: 60px }</style>
    <main>
      <div id="player"><div><video preload="none" src="https://media.example.test/DO_NOT_SEND-one.mp4?secret=DO_NOT_SEND"></video></div>
        <div><h2>Video title</h2><p>Video description.</p></div></div>
      <div id="embed"><iframe src="about:blank" title="Embedded lesson"></iframe><h2>Embedded video title</h2><p>Embedded description.</p></div>
      <div id="listing"><a href="https://example.test/watch/DO_NOT_SEND"><img alt="Video preview"></a>
        <div><h3><a href="https://example.test/watch/DO_NOT_SEND">Listed video title</a></h3><p>Listed description.</p></div></div>
      <div id="neighbor"><a href="https://example.test/watch/two"><img alt="Another preview"></a>
        <h3><a href="https://example.test/watch/two">Neighbor title</a></h3><p>Neighbor description.</p></div>
      <section id="ambiguous"><video></video><h2 id="unrelated-title">One heading</h2><h2>Another heading</h2><p>Unrelated text.</p></section>
      <div id="mismatched"><a href="https://example.test/one"><img alt="Unrelated image"></a>
        <h3><a href="https://example.test/two">Different destination</a></h3></div>
      <section id="discussion"><video></video><h2>Discussion heading</h2><ul><li id="comment">An unrelated comment.</li></ul></section>
      <video id="attributes" title="Attribute title" aria-description="Attribute description" aria-label="Accessible video name"></video>
      <video id="unlabeled"></video>
      <div id="private"><video></video><h2>Public video title</h2><input value="DO_NOT_SEND_INPUT"><p contenteditable>DO_NOT_SEND_DRAFT</p></div>
    </main>`);
  await page.evaluate(async bundles => {
    for (const [name, script] of bundles) {
      const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
      (window as any)[name] = await import(url);
      URL.revokeObjectURL(url);
    }
  }, bundles);
  const scan = (selector: string) => page.evaluate(selector => {
    const { discover, evidence } = (window as any).scan;
    return discover(document.querySelector(selector)).map((el: HTMLElement) => ({ id: el.id, evidence: evidence(el) }));
  }, selector);
  const initial = await scan("main");
  for (const id of ["player", "embed", "listing", "neighbor"]) {
    assert(initial.some((item: any) => item.id === id), `${id} must be a whole media card: ${JSON.stringify(initial.map((item: any) => item.id))}`);
  }
  const player = initial.find((item: any) => item.id === "player")!;
  assert(player.evidence.text.includes("Video title") && player.evidence.text.includes("Video description."));
  assert(!player.evidence.text.includes("Neighbor"));
  assert(!initial.some((item: any) => ["ambiguous", "mismatched", "discussion"].includes(item.id)), "Ambiguous parents and conversations must not become media cards");
  assert(initial.some((item: any) => item.id === "comment"));
  const metadata = initial.find((item: any) => item.id === "attributes")!.evidence;
  for (const text of ["Attribute title", "Attribute description", "Accessible video name"]) assert(metadata.text.includes(text));
  assert.equal(initial.find((item: any) => item.id === "unlabeled")!.evidence.complete, false, "Unlabeled video content remains unchecked");
  assert(!initial.find((item: any) => item.id === "private")!.evidence.text.includes("DO_NOT_SEND"));
  assert.deepEqual((await scan("#player p")).map((item: any) => item.id), ["player"], "Description mutations retain their player boundary");

  const fingerprint = JSON.stringify(player.evidence);
  await page.locator("#player video").evaluate(el => el.setAttribute("src", "https://media.example.test/DO_NOT_SEND-two.mp4?secret=DO_NOT_SEND"));
  assert.notEqual(JSON.stringify((await scan("#player"))[0].evidence), fingerprint, "Same-host source changes invalidate the judgment locally");
  const listing = JSON.stringify((await scan("#listing"))[0].evidence);
  await page.locator("#listing a").evaluateAll(anchors => anchors.forEach(a => a.setAttribute("href", "https://example.test/watch/replacement")));
  assert.notEqual(JSON.stringify((await scan("#listing"))[0].evidence), listing, "A reused thumbnail card has a new identity even with unchanged text");

  await page.evaluate(() => {
    document.querySelector("#player video")!.innerHTML = '<source src="https://media.example.test/first.mp4">';
  });
  const source = JSON.stringify((await scan("#player"))[0].evidence);
  await page.locator("#player source").evaluate(el => el.setAttribute("src", "https://media.example.test/second.mp4"));
  assert.notEqual(JSON.stringify((await scan("#player"))[0].evidence), source, "Nested source changes invalidate metadata judgments");

  await page.locator("#player").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = document.getElementById("player")!;
    const snapshot = JSON.stringify((window as any).scan.evidence(el));
    (window as any).removal = (window as any).effects.removeElement(el, { animate: true },
      () => el.isConnected && JSON.stringify((window as any).scan.evidence(el)) === snapshot);
  });
  await page.waitForFunction(() => document.getElementById("player")!.getAnimations().length > 0);
  await page.locator("#player video").evaluate(el => el.setAttribute("src", "https://media.example.test/new-video.mp4"));
  assert.equal(await page.evaluate(() => (window as any).removal), false, "A source-only swap cancels an already-started removal");
  assert.equal(await page.locator("#player").count(), 1);

  const playback = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const stream = canvas.captureStream(1);
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    shadow.append(video);
    document.body.append(host);
    canvas.getContext("2d")!.fillRect(0, 0, 2, 2);
    try {
      await video.play();
      const staleRemoved = await (window as any).effects.removeElement(host, { animate: false }, () => false);
      const stalePaused = video.paused;
      const removed = await (window as any).effects.removeElement(host, { animate: false }, () => true);
      return { staleRemoved, stalePaused, removed, paused: video.paused, connected: host.isConnected };
    } finally {
      stream.getTracks().forEach(track => track.stop());
      host.remove();
    }
  });
  assert.deepEqual(playback, { staleRemoved: false, stalePaused: false, removed: true, paused: true, connected: false });
  console.log("PASS: media boundaries, private-input exclusions, metadata, source revisions, and guarded playback pause");
} finally {
  await browser.close();
}

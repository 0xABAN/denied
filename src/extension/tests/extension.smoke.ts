import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchExtension } from "./browser";
import { observeJudgments } from "./observe-judgments";
import type { Batch, Judgments, PageStats } from "../contracts";
import { localAPI, until } from "./api";

const publicOnly = process.argv.includes("--public-only");
const motionOnly = process.argv.includes("--motion-only");
assert(!(publicOnly && motionOnly), "Choose --public-only or --motion-only, not both");
const publicURLs = process.argv.filter(arg => /^https:\/\//.test(arg));
const SCAM = "Your bank account will be deleted in ten minutes. Reply with your password and verification code so our agent can save it.";
const GAMBLING = "Join our online casino and place real-money bets to win cash prizes.";
const api = await localAPI();
const site = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { return new Response(Bun.file("src/extension/tests/page.html")); } });

type Observation = { batch: Batch; started: number; elapsed?: number; status?: number; response?: Judgments };
const observations = new Map<object, Observation>();
const errors: string[] = [];
const results: { name: string; details?: unknown }[] = [];
const publicPages: object[] = [];
// Forward genuine API responses unchanged; no substituted classifications.
const observer = observeJudgments(api.url, batch => {
  const observed = { batch, started: performance.now() };
  observations.set(observed, observed);
  return observed as Observation;
}, (observed, status, result) => {
  observed.status = status;
  observed.elapsed = performance.now() - observed.started;
  observed.response = result;
});
const extension = await launchExtension({ apiBase: observer.url, enabled: false }, { viewport: { width: 1100, height: 900 } });
const { context, popup, configure } = extension;
context.on("page", page => page.on("pageerror", error => {
  if (error.stack?.includes("chrome-extension://")) errors.push(error.message);
}));
const page = await context.newPage();
let pageUrl = `http://127.0.0.1:${site.port}/`;
let pageTab: number | undefined;

function pass(name: string, details?: unknown) {
  results.push({ name, details });
  console.log(`PASS: ${name}`);
}
async function stats(debug = false): Promise<PageStats> {
  if (pageTab === undefined) {
    // Resolve once on loopback, where host permission exposes the URL. The tab ID survives navigation.
    pageTab = await popup.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(t => t.url === url);
      if (tab?.id === undefined) throw new Error("Test tab missing");
      return tab.id;
    }, pageUrl);
  }
  return popup.evaluate(({ id, debug }) => chrome.tabs.sendMessage(id, { type: "pageStats", debug }), { id: pageTab, debug });
}
async function add(id: string, text: string) {
  await page.evaluate(({ id, text }) => {
    const p = document.createElement("p");
    p.id = id; p.className = "sample"; p.textContent = text;
    document.body.append(p);
  }, { id, text });
}
async function addLongTag(id: string, text: string) {
  await page.evaluate(({ id, text }) => {
    const element = document.createElement("reddit-custom-element-with-a-long-name");
    element.id = id;
    element.className = "sample";
    element.textContent = text;
    document.body.append(element);
  }, { id, text });
}
async function rescan() {
  await stats();
  await popup.evaluate(id => chrome.tabs.sendMessage(id!, { type: "rescan" }), pageTab);
}
function forTarget(token: string) {
  return [...observations.values()].flatMap(o => o.batch.candidates
    .filter(c => c.ad.tokens.split(" ").includes(token))
    .map(c => ({ candidate: c, result: o.response?.results.find(r => r.id === c.id), observation: o })));
}
async function checked(token: string) {
  await until(() => forTarget(token).some(o => o.result), `real judgment for ${token}`);
  await until(async () => (await stats()).pending === 0, `${token} settled`);
}

let failed: string | null = null;
try {
  await page.goto(pageUrl);
  await page.bringToFront();
  await until(async () => Boolean(await stats().catch(() => null)), "content script ready");
  if (publicOnly) console.log("Controlled-page checks skipped explicitly (--public-only).");
  else {
  await configure({ enabled: true });
  await page.waitForSelector("#ad-card", { state: "detached" });
  await page.waitForSelector("#unsafe", { state: "detached" });
  await until(async () => (await stats()).pending === 0, "initial real judgments settled");
  for (const id of ["safe-card", "benign", "education"]) assert.equal(await page.locator(`#${id}`).count(), 1, `${id} falsely removed`);
  assert(!JSON.stringify([...observations.values()].map(o => o.batch)).includes("DO_NOT_SEND"), "Private input leaked");
  assert.equal((await stats()).total, 2);
  assert([...observations.values()].every(o => o.batch.page_host === "127.0.0.1" && o.batch.page_scheme === "http"));
  pass("actual FastAPI/Jev decisions remove an ad and a scam, retain benign content, exclude inputs");

  await add("animated", SCAM);
  await page.waitForFunction(() => document.querySelector("#animated")?.getAnimations().some(a => a.effect?.getTiming().duration === 600));
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 1,
    "A real Jev-triggered removal must use the glint wind-up renderer");
  await mkdir("artifacts", { recursive: true });
  await page.waitForFunction(() => document.querySelector("#animated")?.getAnimations().some(animation =>
    (animation.effect as KeyframeEffect | null)?.getKeyframes().some(frame => String(frame.transform).includes("scale(0)"))));
  await page.screenshot({ path: "artifacts/real-implosion.png" });
  await page.waitForSelector("#animated", { state: "detached" });
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0,
    "A real Jev-triggered removal must not create a decorative canvas");
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0);
  assert.equal((await stats()).total, 3);
  pass("real flagged content spins, expands, implodes, counts once, and cleans up");

  for (const interaction of ["hover", "scroll"]) {
    await configure({ enabled: false });
    await page.mouse.move(0, 0);
    const before = (await stats()).total;
    const id = `interaction${interaction}`;
    await page.evaluate(({ id, text }) => {
      document.body.style.minHeight = "2000px";
      const target = document.createElement("article");
      target.id = id;
      target.className = "sample";
      target.style.cssText = "position:fixed;left:40px;top:40px;width:360px;z-index:100";
      target.textContent = text;
      target.addEventListener("pointerenter", () => target.classList.add("hovered"));
      target.addEventListener("pointerleave", () => target.classList.remove("hovered"));
      if (id.endsWith("scroll")) window.addEventListener("scroll", () => target.classList.add("scrolled"), { once: true });
      document.body.append(target);
    }, { id, text: SCAM });
    if (interaction === "hover") await page.locator(`#${id}`).hover();
    await configure({ enabled: true });
    if (interaction === "scroll") {
      await page.waitForFunction(id => document.getElementById(id)?.getAnimations().some(a => a.effect?.getTiming().duration === 600), id);
      await page.evaluate(() => window.scrollTo(0, 40));
    }
    await page.waitForSelector(`#${id}`, { state: "detached" });
    await until(async () => (await stats()).total === before + 1, `${interaction} removal counted once`);
    const judgments = forTarget(id);
    assert.equal(judgments.length, 1, "Interaction must not restart inference/removal");
    assert(judgments[0].result?.remove, "Removal must follow the genuine provider decision");
    assert.equal(await page.locator("#safe-card").count(), 1);
    await page.evaluate(() => { document.body.style.removeProperty("min-height"); window.scrollTo(0, 0); });
    pass(`real flagged content completes removal during ${interaction}, without rejudging or double-counting`);
  }

  if (!motionOnly) {
  await add("stale", SCAM);
  await until(() => forTarget("stale").length > 0, "real request dispatched");
  await page.locator("#stale").evaluate(el => { el.textContent = "The library reading group meets on Saturday."; });
  await until(() => forTarget("stale").some(o => o.candidate.text === SCAM && o.result?.remove), "original content actually flagged by Jev");
  await until(() => forTarget("stale").some(o => o.candidate.text.includes("library reading") && o.result && !o.result.remove), "replacement actually allowed by Jev");
  await until(async () => (await stats()).pending === 0, "stale target settled");
  assert.equal(await page.locator("#stale").count(), 1);
  pass("an actual late positive judgment cannot delete changed benign content");

  await add("changed", "The school garden has new seedlings.");
  await checked("changed");
  await page.locator("#changed").evaluate((el, text) => { el.textContent = text; }, SCAM);
  await page.waitForSelector("#changed", { state: "detached" });
  await add("duringglow", SCAM);
  await page.waitForFunction(() => !!document.querySelector("#duringglow")?.getAnimations().length);
  await page.locator("#duringglow").evaluate(el => { el.textContent = "The museum opens on Sunday afternoon."; });
  await until(() => forTarget("duringglow").some(o => o.candidate.text.includes("museum") && o.result && !o.result.remove), "animation replacement allowed");
  await until(async () => (await stats()).pending === 0, "animation canceled");
  assert.equal(await page.locator("#duringglow").count(), 1);
  pass("text mutations are rejudged; changing content cancels an in-progress removal");

  await page.evaluate(() => {
    const p = document.createElement("p"); p.id = "linkchange";
    p.innerHTML = '<a href="https://www.python.org/DO_NOT_SEND?token=DO_NOT_SEND#DO_NOT_SEND">Read more about programming.</a>';
    document.body.append(p);
  });
  await checked("linkchange");
  assert(forTarget("linkchange").some(o => o.candidate.links.some(l => l.destination_host === "www.python.org" && l.destination_scheme === "https")));
  assert(!JSON.stringify([...observations.values()].map(o => o.batch)).includes("DO_NOT_SEND"), "URL path/query/fragment leaked");
  await page.locator("#linkchange a").evaluate(el => el.setAttribute("href", "http://www.python.org/"));
  await until(() => forTarget("linkchange").some(o => o.candidate.links.some(l => l.destination_host === "www.python.org" && l.destination_scheme === "http") && o.result && !o.result.remove), "scheme-only change rejudged without blanket HTTP blocking");
  await page.locator("#linkchange a").evaluate(el => el.setAttribute("href", "https://developer.mozilla.org/"));
  await until(() => forTarget("linkchange").some(o => o.candidate.links.some(l => l.destination_host === "developer.mozilla.org") && o.result), "changed destination rejudged");
  await until(async () => (await stats()).pending === 0, "link settled");
  assert.equal(await page.locator("#linkchange").count(), 1);
  pass("domain and scheme-only link changes are rejudged; HTTP is contextual and URL paths/query tokens stay private");

  await page.evaluate(() => {
    const card = document.createElement("article"); card.id = "shell"; card.className = "banner";
    card.innerHTML = '<p id="shelltext">The library has new books about butterflies.</p>';
    document.body.append(card);
  });
  await checked("shell");
  await page.locator("#shelltext").evaluate((el, text) => { el.textContent = text; }, SCAM);
  await page.waitForSelector("#shell", { state: "detached" });
  pass("a descendant mutation invalidates its already-checked container");

  await addLongTag("longtag", "The school garden has new seedlings.");
  await checked("longtag");
  const longTag = forTarget("longtag").find(o => o.result);
  assert(longTag, "long custom element was not judged");
  assert(longTag.candidate.ad.tag.length <= 20, "custom element tag exceeded the API bound");
  pass("custom element names are bounded before request validation");

  const beforeBoth = await stats();
  await page.evaluate(text => {
    const card = document.createElement("article"); card.id = "both";
    const label = document.createElement("span"); label.textContent = "Sponsored";
    const copy = document.createElement("p"); copy.textContent = text;
    card.append(label, copy); document.body.append(card);
  }, GAMBLING);
  await page.waitForSelector("#both", { state: "detached" });
  const afterBoth = await stats();
  assert.equal(afterBoth.total, beforeBoth.total + 1);
  assert.equal(afterBoth.advertising, beforeBoth.advertising + 1);
  assert.equal(afterBoth.unsafe_content, beforeBoth.unsafe_content + 1);
  await add("long", "The school garden has flowers and butterflies. ".repeat(450) + SCAM);
  await page.waitForSelector("#long", { state: "detached" });
  assert([...observations.values()].every(o => o.batch.candidates.length >= 1 && o.batch.candidates.length <= 20 && o.batch.candidates.every(c => c.text.length <= 24000)));
  pass("a gambling ad counts once with two reasons; unsafe text beyond the first batch is found");

  await api.stop();
  await add("outage", SCAM);
  await until(async () => (await stats()).deferred > 0 && !!(await stats()).error, "actual API outage and retry exhaustion");
  assert.equal(await page.locator("#outage").count(), 1);
  await api.start();
  await rescan();
  await page.waitForSelector("#outage", { state: "detached" });
  pass("stopping the real API preserves content; restarting and rescanning restores filtering");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await add("reduced", SCAM);
  await page.waitForSelector("#reduced", { state: "detached" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const beforeDebug = (await stats()).total;
  await configure({ mode: "highlight" });
  await add("debug", SCAM);
  await page.waitForSelector("#debug [data-denied-ui]");
  assert.equal((await stats()).total, beforeDebug);
  await configure({ enabled: false });
  await add("paused", SCAM);
  await page.waitForSelector("#debug [data-denied-ui]", { state: "detached" });
  assert.equal(await page.locator("#paused").count(), 1);
  await configure({ mode: "remove", enabled: true });
  await page.bringToFront();
  await page.waitForSelector("#debug", { state: "detached" });
  await page.waitForSelector("#paused", { state: "detached" });
  pass("reduced motion, diagnostic-only highlighting, disable, and re-enable work with real judgments");

  const finalCount = (await stats()).total;
  await until(async () => Number(await popup.locator("#all-total").textContent()) === finalCount, "persistent totals");
  const cdp = await context.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await popup.reload();
  await until(async () => Number(await popup.locator("#all-total").textContent()) === finalCount, "totals survive restart");
  assert.equal(await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: "settings" })).settings.enabled), true);
  await popup.screenshot({ path: "artifacts/real-popup.png" });
  pass("settings and counts survive actual service-worker shutdown", { removals: finalCount });
  }
  }

  // Public pages use the same unmodified extension and provider. No login or cookie-consent actions.
  const sites = motionOnly ? [] : publicURLs.length ? publicURLs : ["https://example.com/", "https://www.python.org/about/", "https://www.w3schools.com/html/"];
  for (const url of sites) {
    await configure({ enabled: false });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      pageUrl = page.url();
      const heading = await page.locator("h1").first().innerText();
      const adSlots = new URL(url).hostname === "www.w3schools.com" ? "iframe[data-actirise]" : null;
      if (adSlots) await page.waitForSelector(adSlots, { state: "visible", timeout: 20000 });
      const before = observations.size;
      await configure({ enabled: true });
      await page.bringToFront();
      await until(() => observations.size > before, `real requests on ${url}`);
      await until(async () => (await stats()).pending === 0, `public page settled: ${url}`, 45000);
      if (adSlots) await until(async () => await page.locator(adSlots).evaluateAll(nodes => nodes.every(el => !el.getClientRects().length)), `visible provider ad slots removed: ${url}`);
      assert.equal(await page.locator("h1").first().innerText(), heading, "Page heading incorrectly removed");
      const checked = await stats();
      assert.equal(checked.error, null);
      if (adSlots) assert(checked.advertising > 0, "Identified ad slots were not counted as removed");
      const host = new URL(url).hostname;
      await page.screenshot({ path: `artifacts/public-${host}.png` });
      const judgments = [...observations.values()].slice(before).filter(o => o.response);
      assert(judgments.length > 0 && judgments.every(o => o.batch.page_host === new URL(pageUrl).hostname && o.batch.page_scheme === "https"));
      if (adSlots) assert(judgments.some(o => o.batch.candidates.some(c => c.ad.network && c.ad.source_scheme)), "Ad iframe scheme missing from evidence");
      const flagged = judgments.flatMap(o => o.response!.results.filter(r => r.remove).map(r => ({
        reasons: r.reasons, ad: r.ad_score, unsafe: r.unsafe_score,
        excerpt: o.batch.candidates.find(c => c.id === r.id)?.text.slice(0, 160),
      })));
      const outcome = { url: pageUrl, ...checked, apiBatches: observations.size - before, flagged };
      publicPages.push(outcome);
      pass(`live public-page check: ${host}`, outcome);
    } catch (error) {
      const snapshot = await stats(true).catch(() => null);
      publicPages.push({ url, error: error instanceof Error ? error.message : String(error), snapshot });
      console.error("Page state:", snapshot);
      console.error("Remaining provider frames:", await page.locator("iframe[data-actirise]").evaluateAll(nodes => nodes.map(el => {
        const parents = []; let node: Element | null = el;
        for (let i = 0; node && i < 4; i++, node = node.parentElement) parents.push({ tag: node.tagName, id: node.id, classes: node.getAttribute("class"), provider: node.hasAttribute("data-actirise") });
        return { visible: el.getClientRects().length > 0, parents };
      })));
      const pageObservations = [...observations.values()].filter(o => o.batch.page_host === new URL(url).hostname);
      console.error("Ad evidence:", pageObservations.flatMap(o => o.batch.candidates.filter(c => c.ad.tag === "iframe" || c.ad.network || /sticky|leaderboard/i.test(c.ad.tokens)).map(c => ({ text: c.text.slice(0, 160), ad: c.ad, verdict: o.response?.results.find(r => r.id === c.id) }))));
      const missed = pageObservations.find(o => o.batch.candidates.some(c => c.ad.network && o.response?.results.some(r => r.id === c.id && !r.remove)));
      if (missed) await Bun.write("artifacts/public-failure-input.json", JSON.stringify(missed.batch, null, 2));
      console.error(`PUBLIC PAGE FAILED: ${url}: ${error instanceof Error ? error.message : error}`);
    }
  }
  assert.deepEqual(errors, []);
  assert(!publicPages.some(result => Boolean((result as { error?: unknown }).error)), "A public-page check failed; see artifacts/real-results.json");
} catch (error) {
  failed = error instanceof Error ? error.message : String(error);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/real-failure.png" }).catch(() => {});
  console.error("FAILED:", failed);
  console.error("Last judgments:", JSON.stringify([...observations.values()].slice(-2).map(o => ({ status: o.status, elapsed: o.elapsed, flagged: o.response?.results.filter(r => r.remove) })), null, 2));
} finally {
  await extension.close();
  observer.stop();
  site.stop(true);
  await api.stop();
  await mkdir("artifacts", { recursive: true });
  await Bun.write("artifacts/real-results.json", JSON.stringify({
    timestamp: new Date().toISOString(), provider: "jev-latest", results, publicPages, failed,
    roundTripsMs: [...observations.values()].filter(o => o.elapsed !== undefined).map(o => Math.round(o.elapsed!)),
  }, null, 2));
}
if (failed) throw new Error(failed);
console.log(`${results.length} real browser checks passed. Results: artifacts/real-results.json`);

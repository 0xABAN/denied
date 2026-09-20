/** Actual Chromium ownership contracts. These fixture tests do not assert live-site support. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { adapterFixtures, fixturePage, youtubeShortsShelf } from "./adapters.fixtures";
import { adapterVariants } from "./adapters.variants";

const scripts: Record<string, string> = {};
for (const [name, entrypoint] of Object.entries({ adapters: "src/extension/adapters/index.ts", scan: "src/extension/scan.ts", effects: "src/extension/effects.ts" })) {
  const bundle = await Bun.build({ entrypoints: [entrypoint], target: "browser", format: "esm" });
  assert(bundle.success);
  scripts[name] = await bundle.outputs[0].text();
}
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  for (const fixture of adapterFixtures) {
    await page.setContent(fixturePage(fixture));
    await page.evaluate(async scripts => {
      for (const [name, script] of Object.entries(scripts)) {
        const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
        (window as any)[name] = await import(url);
        URL.revokeObjectURL(url);
      }
    }, scripts);
    const result = await page.evaluate(url => {
      const api = (window as any).adapters;
      const target = document.querySelector('[data-fixture="target"]')!;
      const scope = api.ownership(target.querySelector(".probe"), new URL(url));
      const scan = (window as any).scan;
      const discovered = scan.discover(document.body, undefined, new URL(url));
      const evidence = scan.evidence(target, new URL(url));
      return {
        discovered: discovered.includes(target) && discovered.includes(document.querySelector('[data-fixture="neighbor"]')),
        evidence: evidence.text,
        private: JSON.stringify(evidence).includes("DO_NOT_SEND"),
        site: api.adapterFor(new URL(url))?.id,
        exact: scope?.key === target && scope.nodes.length === 1 && scope.nodes[0] === target,
        protected: ["navigation", "composer"].every(id => !scope?.nodes.some((node: Node) => node.contains(document.getElementById(id)))),
        neighbor: !scope?.nodes.some((node: Node) => node.contains(document.querySelector('[data-fixture="neighbor"]'))),
        spoof: api.adapterFor(new URL(`https://${new URL(url).hostname}.evil.test${new URL(url).pathname}`))?.id || null,
        key: scope?.key.outerHTML.slice(0, 200),
      };
    }, fixture.url);
    assert.equal(result.site, fixture.site);
    assert(result.exact, `${fixture.site}: incomplete item boundary: ${JSON.stringify(result)}`);
    assert(result.protected && result.neighbor, `${fixture.site}: collateral scope`);
    assert.equal(result.spoof, null);
    assert(result.discovered, `${fixture.site}: scanner lost a complete item`);
    assert(result.evidence.includes("Tickets for sale") && !result.evidence.includes("butterflies"));
    assert(!result.private, `${fixture.site}: leaked a private input`);
    const removed = await page.evaluate(async url => {
      const scope = (window as any).adapters.ownership(document.querySelector('[data-fixture="target"]'), new URL(url));
      const result = await (window as any).effects.removeScope(scope, { animate: false }, () => true);
      return { result, target: document.querySelector('[data-fixture="target"]') !== null,
        neighbor: document.querySelector('[data-fixture="neighbor"]') !== null,
        composer: document.getElementById("composer") !== null, navigation: document.getElementById("navigation") !== null };
    }, fixture.url);
    assert.deepEqual(removed, { result: true, target: false, neighbor: true, composer: true, navigation: true }, fixture.site);
  }

  await page.setContent('<div data-test-id="pinWrapper"><a href="/pin/example"><span>Example pin text</span></a></div>');
  for (const host of ["pinterest.com", "www.pinterest.com"]) {
    const fallback = await page.evaluate(host => {
      const url = new URL(`https://${host}/`);
      const api = (window as any).adapters;
      const scan = (window as any).scan;
      const pin = document.querySelector('[data-test-id="pinWrapper"]')!;
      const candidates = scan.discover(document.body, undefined, url);
      return {
        adapter: api.adapterFor(url)?.id ?? null,
        scope: api.ownership(pin, url),
        text: candidates.map((el: HTMLElement) => scan.evidence(el, url).text).join(" "),
      };
    }, host);
    assert.deepEqual(fallback, { adapter: null, scope: null, text: "Example pin text" },
      "Pinterest must use generic discovery, not its disabled adapter");
  }

  const declaredRules = await page.evaluate(() => (window as any).adapters.adapters.flatMap((adapter: any) =>
    adapter.rules.map((_: unknown, index: number) => `${adapter.id}:${index}`)));
  const testedRules = [...adapterFixtures.map(fixture => `${fixture.site}:0`),
    ...adapterVariants.map(variant => `${variant.site}:${variant.rule}`)];
  assert.deepEqual(declaredRules.sort(), [...new Set(testedRules)].sort(), "Every declared adapter rule needs a structural fixture");

  for (const variant of adapterVariants) {
    const fixture = adapterFixtures.find(item => item.site === variant.site)!;
    const url = "url" in variant ? variant.url : fixture.url;
    await page.setContent(`<style>[data-fixture] { display:block } video { width:200px;height:100px }</style>
      <nav id="navigation">KEEP_SIBLING</nav>${variant.html}<aside id="neighbor">KEEP_SIBLING</aside>
      <form id="composer"><textarea>DO_NOT_SEND_DRAFT</textarea></form>`);
    const result = await page.evaluate(async ({ url, rule }) => {
      const api = (window as any).adapters;
      const scan = (window as any).scan;
      const target = document.querySelector('[data-fixture="extra"]')!;
      const location = new URL(url);
      const scope = api.ownership(target, location);
      const protectedNodes = [...document.querySelectorAll("[data-retain],#neighbor,#navigation,#composer")];
      const targets = scan.discover(document.body, undefined, location);
      const value = scan.evidence(target, location);
      const owned = [...(scope?.nodes || [])];
      const validRule = target.matches(api.adapterFor(location).rules[rule].selector);
      const removed = scope && await (window as any).effects.removeScope(scope, { animate: false }, () => true);
      return { validRule, discovered: targets.includes(target), removed, ownedRemoved: owned.length > 0 && owned.every(node => !node.isConnected),
        protected: protectedNodes.every(node => node.isConnected), text: value.text };
    }, { url, rule: variant.rule });
    assert(result.validRule && result.discovered && result.removed && result.ownedRemoved && result.protected,
      `${variant.site} rule ${variant.rule}: ${JSON.stringify(result)}`);
    assert(!result.text.includes("KEEP_") && !result.text.includes("DO_NOT_SEND"));
  }

  await page.setContent(fixturePage(adapterFixtures.find(item => item.site === "google")!));
  const reusedLink = await page.evaluate(() => {
    const url = new URL("https://www.google.com/search?q=garden");
    const target = document.querySelector('[data-fixture="target"]')!;
    const before = (window as any).scan.evidence(target, url);
    target.querySelector("a")!.setAttribute("href", "https://example.test/replacement?secret=DO_NOT_SEND");
    const after = (window as any).scan.evidence(target, url);
    return { before: before.ownership_revision, after: after.ownership_revision, text: after.text };
  });
  assert.notEqual(reusedLink.before, reusedLink.after, "Same-host text-only result URL changes must invalidate ownership");
  assert(!reusedLink.text.includes("DO_NOT_SEND"));
  const hiddenInput = await page.evaluate(() => {
    const target = document.querySelector('[data-fixture="target"]')!;
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.value = "DO_NOT_SEND_TOKEN";
    target.append(hidden);
    const toolbar = document.createElement("div");
    toolbar.setAttribute("role", "toolbar");
    toolbar.innerHTML = "<button>Item actions</button>";
    target.append(toolbar);
    const seek = document.createElement("input");
    seek.type = "range";
    target.append(seek);
    const url = new URL("https://www.google.com/search?q=garden");
    const scope = (window as any).adapters.ownership(target, url);
    return { whole: scope.nodes.length === 1 && scope.nodes[0] === target,
      private: JSON.stringify((window as any).scan.evidence(target, url)).includes("DO_NOT_SEND") };
  });
  assert.deepEqual(hiddenInput, { whole: true, private: false }, "Owned action/playback controls and hidden fields must leave with their item");

  await page.setContent(`<shreddit-post post-id="one" id="post"><b>Author</b><p id="body">Tickets for sale.</p>
    <div id="replies"><shreddit-comment comment-id="two" id="reply"><p>Keep this reply.</p></shreddit-comment></div>
    <div contenteditable id="draft">DO_NOT_SEND_DRAFT</div></shreddit-post>`);
  const nested = await page.evaluate(() => {
    const url = new URL("https://www.reddit.com/r/example/");
    const scan = (window as any).scan;
    const post = document.getElementById("post")!;
    const targets = scan.discover(document.body, undefined, url);
    const value = scan.evidence(post, url);
    const before = value.ownership_revision;
    document.querySelector("#reply p")!.textContent = "Keep this updated reply.";
    const afterText = scan.evidence(post, url).ownership_revision;
    const added = document.createElement("shreddit-comment");
    added.textContent = "Another independent reply.";
    document.getElementById("replies")!.append(added);
    const afterAddition = scan.evidence(post, url).ownership_revision;
    return { ids: targets.map((el: HTMLElement) => el.id), text: value.text, before, afterText, afterAddition };
  });
  assert(nested.ids.includes("post") && nested.ids.includes("reply"), "Independent nested replies must remain candidates");
  assert(!nested.text.includes("reply") && !nested.text.includes("DO_NOT_SEND"));
  assert.equal(nested.before, nested.afterText, "Unrelated reply text does not contaminate the parent's evidence");
  assert.notEqual(nested.before, nested.afterAddition, "New structural membership invalidates the old scope");

  const nestedRemoval = await page.evaluate(async () => {
    const scope = (window as any).adapters.ownership(document.getElementById("post"), new URL("https://www.reddit.com/r/example/"));
    const removed = await (window as any).effects.removeScope(scope, { animate: true }, () => true);
    return { removed, body: Boolean(document.getElementById("body")), reply: Boolean(document.getElementById("reply")), draft: Boolean(document.getElementById("draft")) };
  });
  assert.deepEqual(nestedRemoval, { removed: true, body: false, reply: true, draft: true });

  for (const site of ["groupme", "discord", "slack", "telegram"]) {
    const fixture = adapterFixtures.find(item => item.site === site)!;
    await page.setContent(fixturePage(fixture));
    const shared = await page.evaluate(async url => {
      const api = (window as any).adapters;
      const location = new URL(url);
      const rule = api.adapterFor(location).rules.find((rule: any) => rule.sharedIdentity);
      const first = document.querySelector('[data-fixture="target"]')!;
      const next = document.querySelector('[data-fixture="neighbor"]')!;
      next.querySelectorAll(rule.sharedIdentity.selector).forEach((el: Element) => el.remove());
      const headers = [...first.querySelectorAll(rule.sharedIdentity.selector)];
      const before = (window as any).scan.evidence(first, location);
      const scope = api.ownership(first, location);
      const result = await (window as any).effects.removeScope(scope, { animate: false }, () => true);
      return { result, body: Boolean(first.querySelector(".probe")), shared: headers.length > 0 && headers.every(el => el.isConnected),
        next: next.isConnected, classifiedSharedIdentity: before.text.includes("Example author") };
    }, fixture.url);
    assert.deepEqual(shared, { result: true, body: false, shared: true, next: true, classifiedSharedIdentity: false }, `${site}: shared identity`);
  }

  const shorts = youtubeShortsShelf("shorts-shelf", [["first-short", "Tickets for sale."], ["last-short", "Tickets for sale."]]);
  for (const retained of ["", '<ytm-shorts-lockup-view-model hidden><a href="/shorts/unchecked">Unchecked Short</a></ytm-shorts-lockup-view-model>',
    '<p>Unrecognized content</p>', '<input value="DO_NOT_SEND">', '<div contenteditable></div>', '<div id="shadow-content"></div>']) {
    await page.setContent(`<style>grid-shelf-view-model,ytm-shorts-lockup-view-model-v2 {display:block} img {width:30px;height:30px}</style>
      <nav id="navigation">Keep navigation</nav>${shorts}<p id="neighbor">Keep this result</p>`);
    const result = await page.evaluate(async retained => {
      const url = new URL("https://www.youtube.com/results?search_query=example");
      const api = (window as any).adapters;
      const effects = (window as any).effects;
      const shelf = document.getElementById("shorts-shelf")!;
      const first = document.getElementById("first-short")!;
      const last = document.getElementById("last-short")!;
      const scope = api.ownership(first.querySelector("h3 a"), url);
      if (scope?.key !== first || scope.nodes.length !== 1 || scope.nodes[0] !== first) return { wholeCard: false };
      const evidence = (window as any).scan.evidence(first, url);
      const discovered = (window as any).scan.discover(shelf, undefined, url);
      const stale = await effects.removeScope(scope, { animate: false }, () => false);
      const staleRetained = first.isConnected && shelf.isConnected;
      const removedFirst = await effects.removeScope(scope, { animate: false }, () => true);
      const remainingPreserved = shelf.isConnected && last.isConnected;
      // A last-card removal must re-check new, hidden, private and shadow content.
      shelf.querySelector(".ytGridShelfViewModelGridShelfRow")!.insertAdjacentHTML("beforeend", retained);
      document.getElementById("shadow-content")?.attachShadow({ mode: "open" }).append(document.createElement("video"));
      const removedLast = await effects.removeScope(api.ownership(last, url), { animate: false }, () => true);
      return { wholeCard: true, stale, staleRetained, removedFirst, removedLast, remainingPreserved,
        discovered: discovered.includes(first) && discovered.includes(last),
        evidence: evidence.text.includes("Tickets for sale") && !evidence.text.includes("Shorts") && !evidence.text.includes("Show more"),
        shelfRetained: shelf.isConnected, neighbors: Boolean(document.getElementById("navigation") && document.getElementById("neighbor")) };
    }, retained);
    assert.deepEqual(result, { wholeCard: true, stale: false, staleRetained: true, removedFirst: true, removedLast: true,
      remainingPreserved: true, discovered: true, evidence: true, shelfRetained: Boolean(retained), neighbors: true },
      "Shorts ownership and empty-shelf cleanup must preserve unchecked or independent content");
  }

  for (const wrapper of ["legacy", "rich-item"]) {
    await page.setContent(shorts);
    const whole = await page.evaluate(wrapper => {
      const original = document.getElementById("first-short")!;
      let key: Element;
      if (wrapper === "legacy") {
        key = original.firstElementChild!;
        original.replaceWith(key);
      } else {
        key = document.createElement("ytd-rich-item-renderer");
        original.replaceWith(key);
        key.append(original);
      }
      const scope = (window as any).adapters.ownership(key.querySelector("h3 a"), new URL("https://www.youtube.com/"));
      return scope?.key === key && scope.nodes.length === 1 && scope.nodes[0] === key;
    }, wrapper);
    assert(whole, `${wrapper}: nested Shorts renderers must not split an existing whole-card boundary`);
  }

  await page.setContent(youtubeShortsShelf("shorts-shelf", [["last-short", "Tickets for sale."]]));
  const repopulated = await page.evaluate(async () => {
    customElements.define("ytm-shorts-lockup-view-model-v2", class extends HTMLElement {
      disconnectedCallback() {
        if (this.id === "last-short") document.querySelector("#shorts-shelf .ytGridShelfViewModelGridShelfRow")
          ?.insertAdjacentHTML("beforeend", '<ytm-shorts-lockup-view-model id="new-short"><a href="/shorts/new">New unchecked Short</a></ytm-shorts-lockup-view-model>');
      }
    });
    const scope = (window as any).adapters.ownership(document.getElementById("last-short"), new URL("https://www.youtube.com/"));
    const removed = await (window as any).effects.removeScope(scope, { animate: false }, () => true);
    return { removed, retained: Boolean(document.getElementById("shorts-shelf") && document.getElementById("new-short")) };
  });
  assert.deepEqual(repopulated, { removed: true, retained: true }, "Synchronous shelf repopulation must survive cleanup");

  const watch = `<ytd-watch-flexy id="watch"><div id="player-container-outer"><video muted></video></div>
    <ytd-watch-metadata><div id="above-the-fold"><div id="title"><h1>Example video</h1></div></div><div id="description">Example description.</div></ytd-watch-metadata>
    <div id="comments"><p>Keep this comment.</p></div><div id="related"><p>Keep this recommendation.</p></div></ytd-watch-flexy>`;
  await page.setContent(watch);
  const playback = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const stream = canvas.captureStream(1);
    const video = document.querySelector("video")!;
    video.srcObject = stream;
    canvas.getContext("2d")!.fillRect(0, 0, 2, 2);
    try {
      await video.play();
      const scope = (window as any).adapters.ownership(document.getElementById("watch"), new URL("https://www.youtube.com/watch?v=example"));
      const effects = (window as any).effects;
      const stale = await effects.removeScope(scope, { animate: false }, () => false);
      const stalePaused = video.paused;
      const removed = await effects.removeScope(scope, { animate: true }, () => true);
      return { stale, stalePaused, removed, paused: video.paused, player: video.isConnected,
        metadata: Boolean(document.getElementById("above-the-fold")), comments: Boolean(document.getElementById("comments")), related: Boolean(document.getElementById("related")) };
    } finally { stream.getTracks().forEach(track => track.stop()); }
  });
  assert.deepEqual(playback, { stale: false, stalePaused: false, removed: true, paused: true, player: false, metadata: false, comments: true, related: true });

  await page.setContent(watch.replaceAll('div id="player-container-outer"', 'mutating-player id="player-container-outer"').replace("</video></div>", "</video></mutating-player>"));
  const mutation = await page.evaluate(async () => {
    customElements.define("mutating-player", class extends HTMLElement {
      disconnectedCallback() {
        if (this.dataset.mutate === "identity") document.getElementById("watch")!.setAttribute("video-id", "replacement");
        else if (this.dataset.mutate === "stream") (document.getElementById("late-media") as HTMLVideoElement).srcObject = new MediaStream();
        else document.getElementById("above-the-fold")!.append(document.createTextNode("New unrelated content"));
      }
    });
    const scope = (window as any).adapters.ownership(document.getElementById("watch"), new URL("https://www.youtube.com/watch?v=example"));
    const removed = await (window as any).effects.removeScope(scope, { animate: false }, () => true);
    return { removed, retained: document.getElementById("above-the-fold")?.textContent?.includes("New unrelated content") };
  });
  assert.deepEqual(mutation, { removed: false, retained: true }, "Synchronous custom-element mutations must stop a multi-region commit");
  for (const field of ["identity", "stream"]) {
    await page.setContent(watch.replace('div id="player-container-outer"', 'mutating-player id="player-container-outer"').replace("</video></div>", "</video></mutating-player>"));
    const changed = await page.evaluate(async field => {
      document.getElementById("player-container-outer")!.dataset.mutate = field;
      const media = document.createElement("video");
      media.id = "late-media";
      media.srcObject = new MediaStream();
      document.getElementById("above-the-fold")!.append(media);
      const scope = (window as any).adapters.ownership(document.getElementById("watch"), new URL("https://www.youtube.com/watch?v=example"));
      const removed = await (window as any).effects.removeScope(scope, { animate: false }, () => true);
      const retained = media.isConnected;
      media.srcObject = null;
      return { removed, retained };
    }, field);
    assert.deepEqual(changed, { removed: false, retained: true }, `${field} changes must invalidate even unchanged-text regions`);
  }

  console.log(`PASS: ${adapterFixtures.length} adapters / ${adapterFixtures.length + adapterVariants.length} rule shapes, exact removal, protected replies/drafts/shared identities, playback, freshness, and hostname boundaries`);
} finally {
  await browser.close();
}

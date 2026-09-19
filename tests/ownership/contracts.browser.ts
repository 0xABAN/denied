/** Browser contract tests use explicit approved sets, not fake model answers or classifications. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { cases, variants } from "./corpus";
import { challenges } from "./challenge";
import { installPrototype, loadCase } from "./browser";

const build = await Bun.build({ entrypoints: ["extension/src/ownership/index.ts"], target: "browser", format: "esm" });
assert(build.success);
const script = await build.outputs[0].text();
assert.equal(cases.length, 48);
assert.equal(new Set(cases.map(test => test.name)).size, 48);
assert.equal(cases.filter(test => test.split === "holdout").length, 14);
const browser = await chromium.launch({ channel: "chromium", headless: true });
let checks = 0;
const observationTimes: number[] = [];
try {
  const page = await browser.newPage();
  for (const test of [...cases, ...challenges]) {
    for (const variant of variants) {
      await loadCase(page, test, variant);
      await installPrototype(page, script);
      const result = await page.evaluate(({ roots, keep }) => {
        const { ownership: api, findFixture: find } = window as any;
        const start = performance.now();
        const snapshot = api.observe(find("fixture"));
        const observationMs = performance.now() - start;
        const expectedRoots = roots.map(id => find(id) as Node);
        const keepNodes = keep.map(id => find(id) as Node);
        if ([...expectedRoots, ...keepNodes, find("seed")].some(node => !node)) throw new Error("Invalid fixture labels");
        const approved = snapshot.atoms.filter((id: string) => expectedRoots.some((root: Node) => api.contains(root, snapshot.refs.get(id))));
        const protectedAtoms = snapshot.atoms.filter((id: string) => !approved.includes(id)).map((id: string) => snapshot.refs.get(id) as Node);
        // Independently enumerate DOM text, including open roots, to catch omissions/duplicates.
        const missing: string[] = [];
        const checkText = (node: Node): void => {
          if (node instanceof Element && node.matches("script,style,template,input,textarea,select,[contenteditable]")) return;
          if (node instanceof Text && node.data.trim()) {
            if (![...snapshot.refs.values()].includes(node)) missing.push(node.data);
          }
          for (const child of node.childNodes) checkText(child);
          if (node instanceof Element && node.shadowRoot) checkText(node.shadowRoot);
        };
        checkText(find("fixture"));
        const wire = JSON.stringify(snapshot.data);
        const plan = api.planRemoval(snapshot, approved);
        const committed = api.commitRemoval(plan, () => true);
        return {
          observationMs, missing, complete: snapshot.complete,
          duplicateRefs: snapshot.refs.size !== new Set(snapshot.refs.values()).size,
          leaked: wire.includes("PRIVATE_") || wire.includes("token=private") || /"id":"(?:item|seed|safe)"/.test(wire),
          kept: [...keepNodes, ...protectedAtoms].every((node: Node) => node.isConnected),
          removed: expectedRoots.every((node: Node) => !node.isConnected),
          committed, approvedCount: approved.length,
        };
      }, { roots: test.roots, keep: test.keep });
      const label = `${test.name}/${variant}`;
      assert.deepEqual(result.missing, [], label);
      assert(result.complete && !result.duplicateRefs && !result.leaked, label);
      assert(result.kept && result.removed && !result.committed.cancelled, `${label}: ${JSON.stringify(result)}`);
      observationTimes.push(result.observationMs);
      checks++;
    }
  }

  // Mutation cases are distinct from model accuracy and from cosmetic variants.
  for (const mutation of ["text", "same-text-replacement", "new-reply", "reparent", "link", "slot", "disabled", "removed"] as const) {
    await loadCase(page, cases[0]);
    await installPrototype(page, script);
    const result = await page.evaluate(mutation => {
      const { ownership: api, findFixture: find } = window as any;
      const seed = find("seed");
      const item = find("item");
      const snapshot = api.observe(find("fixture"));
      const approved = snapshot.atoms.filter((id: string) => api.contains(item, snapshot.refs.get(id)));
      const plan = api.planRemoval(snapshot, approved);
      if (mutation === "text") seed.firstChild.data = "The study session is tomorrow.";
      if (mutation === "same-text-replacement") seed.replaceWith(seed.cloneNode(true));
      if (mutation === "new-reply") item.append(Object.assign(document.createElement("p"), { textContent: "Do not send money." }));
      if (mutation === "reparent") find("safe").append(seed);
      if (mutation === "link") seed.append(Object.assign(document.createElement("a"), { href: "https://example.org/", textContent: "Help" }));
      if (mutation === "slot") seed.setAttribute("slot", "different-message");
      if (mutation === "removed") item.remove();
      const committed = api.commitRemoval(plan, () => mutation !== "disabled");
      return { committed, kept: find("safe").isConnected, itemConnected: item.isConnected };
    }, mutation);
    assert(result.committed.cancelled && result.committed.removed.length === 0 && result.kept, mutation);
    if (mutation !== "removed") assert(result.itemConnected, mutation);
    checks++;
  }

  for (const kind of ["node-limit", "text-limit", "unknown-id", "private", "hidden", "partial-approval"] as const) {
    await loadCase(page, cases[0]);
    await installPrototype(page, script);
    const result = await page.evaluate(kind => {
      const { ownership: api, findFixture: find } = window as any;
      const item = find("item");
      if (kind === "private") item.append(Object.assign(document.createElement("input"), { value: "PRIVATE_PASSWORD" }));
      if (kind === "hidden") item.append(Object.assign(document.createElement("p"), { hidden: true, textContent: "PRIVATE_HIDDEN" }));
      const snapshot = api.observe(find("fixture"), kind === "node-limit" ? { maxNodes: 3 } : kind === "text-limit" ? { maxText: 4 } : {});
      const approved = snapshot.atoms.filter((id: string) => api.contains(item, snapshot.refs.get(id)));
      if (kind === "unknown-id") approved.push("not-a-real-node");
      if (kind === "partial-approval") approved.pop();
      const plan = api.planRemoval(snapshot, approved);
      const committed = api.commitRemoval(plan, () => true);
      return { complete: snapshot.complete, committed, itemConnected: item.isConnected, leaked: JSON.stringify(snapshot.data).includes("PRIVATE_") };
    }, kind);
    assert(result.itemConnected && !result.leaked, kind);
    if (["node-limit", "text-limit", "unknown-id"].includes(kind)) assert(result.committed.cancelled, kind);
    checks++;
  }

  for (const kind of ["editable-ancestor", "hidden-ancestor", "private-shadow-ancestor"] as const) {
    await loadCase(page, cases[0]);
    await installPrototype(page, script);
    const result = await page.evaluate(kind => {
      const { ownership: api, findFixture: find } = window as any;
      const outer = document.createElement("div");
      outer.innerHTML = "<p>PRIVATE_DRAFT_INSIDE_ANCESTOR</p>";
      if (kind === "hidden-ancestor") outer.style.display = "none";
      else outer.contentEditable = "true";
      let target = outer.firstElementChild;
      if (kind === "private-shadow-ancestor") {
        const shadow = outer.attachShadow({ mode: "open" });
        shadow.innerHTML = "<p>PRIVATE_SHADOW_DRAFT</p>";
        target = shadow.firstElementChild;
      }
      find("fixture").append(outer);
      const snapshot = api.observe(target);
      return JSON.stringify(snapshot.data).includes("PRIVATE_");
    }, kind);
    assert.equal(result, false, `Subtree extraction must respect ${kind}`);
    checks++;
  }

  await loadCase(page, cases[0]);
  await installPrototype(page, script);
  const callback = await page.evaluate(() => {
    const { ownership: api, findFixture: find } = window as any;
    customElements.define("callback-item", class extends HTMLElement {
      disconnectedCallback() {
        find("seed").textContent = "A legitimate replacement arrived during removal.";
      }
    });
    const trigger = document.createElement("callback-item");
    trigger.textContent = "First approved item.";
    find("fixture").prepend(trigger);
    const snapshot = api.observe(find("fixture"));
    const approved = snapshot.atoms.filter((id: string) => [trigger, find("item")].some(node => api.contains(node, snapshot.refs.get(id))));
    const committed = api.commitRemoval(api.planRemoval(snapshot, approved), () => true);
    return { committed, seed: find("seed").isConnected };
  });
  assert(callback.committed.cancelled && callback.committed.removed.length === 1 && callback.seed,
    "A synchronous page callback must stop later deletions");
  checks++;
} finally {
  await browser.close();
}
observationTimes.sort((a, b) => a - b);
console.log(JSON.stringify({ passed: checks, authoredScenarios: cases.length + challenges.length, variantsPerScenario: variants.length,
  mutationAndSafetyChecks: checks - (cases.length + challenges.length) * variants.length,
  observationMedianMs: observationTimes[Math.floor(observationTimes.length / 2)],
  observationP95Ms: observationTimes[Math.floor(observationTimes.length * 0.95)] }, null, 2));

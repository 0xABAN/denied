/** Traverse real light/shadow/slot DOM without repeatedly materializing NodeLists. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const build = await Bun.build({ entrypoints: ["src/extension/adapters/index.ts"], target: "browser", format: "esm" });
assert(build.success);
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async source => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const { scopeTree } = await import(url);
    URL.revokeObjectURL(url);
    const host = document.createElement("div");
    host.id = "host";
    host.innerHTML = '<b slot="content" id="assigned">Assigned</b><i id="unassigned">Not rendered</i>';
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<section id="wrapper"><slot name="content"><b>Unused fallback</b></slot><slot name="empty"><em id="fallback">Fallback</em></slot></section>';
    const original = Object.getOwnPropertyDescriptor(Node.prototype, "childNodes")!;
    let reads = 0;
    Object.defineProperty(Node.prototype, "childNodes", { ...original, get() {
      reads++;
      return original.get!.call(this);
    } });
    try {
      const names = (nodes: Node[]) => nodes.map(node => node instanceof Element
        ? node.id || node.tagName.toLowerCase() : node.textContent);
      const first = names(scopeTree([host, host.querySelector("b")]));
      const firstReads = reads;
      host.querySelector("b")!.textContent = "Changed";
      const second = names(scopeTree([host]));
      return { first, firstReads, second };
    } finally { Object.defineProperty(Node.prototype, "childNodes", original); }
  }, await build.outputs[0].text());
  assert.deepEqual(result.first, ["host", "wrapper", "slot", "assigned", "Assigned", "slot", "fallback", "Fallback"]);
  assert.equal(result.firstReads, 0, "Traversal should use sibling links, not repeated childNodes collection reads");
  assert(result.second.includes("Changed"), "A subsequent traversal must observe mutations");
  console.log("PASS: rendered order, slot fallback, overlapping roots, and fresh traversal without NodeList reads");
} finally { await browser.close(); }

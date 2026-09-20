/** Real DOM reads: one visibility check per element per synchronous snapshot. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const build = await Bun.build({ entrypoints: ["src/extension/scan.ts"], target: "browser", format: "esm" });
assert(build.success);
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<article id="item"><a href="https://example.com">First<!-- split --> second<!-- split --> third</a><p>Other text</p></article>');
  const result = await page.evaluate(async source => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const { evidence } = await import(url);
    URL.revokeObjectURL(url);
    const item = document.getElementById("item")!;
    const link = item.querySelector("a")!;
    const original = window.getComputedStyle;
    let reads = 0;
    window.getComputedStyle = function(element, pseudo) {
      if (element === link) reads++;
      return original.call(window, element, pseudo);
    };
    try {
      const first = evidence(item);
      const firstReads = reads;
      link.style.display = "none";
      const hidden = evidence(item);
      link.style.display = "";
      link.textContent = "Replacement";
      const changed = evidence(item);
      item.innerHTML = Array.from({ length: 9 }, (_, index) =>
        `<a href="https://${index === 8 ? "doubleclick.net" : "example.com"}">Link ${index}</a>`).join(" ");
      const firstText = item.querySelector("a")!.firstChild;
      const lastText = item.querySelector("a:last-child")!.firstChild;
      const data = Object.getOwnPropertyDescriptor(CharacterData.prototype, "data")!;
      let payloadReads = 0;
      let excessReads = 0;
      Object.defineProperty(CharacterData.prototype, "data", { ...data, get() {
        if (this === firstText) payloadReads++;
        if (this === lastText) excessReads++;
        return data.get!.call(this);
      } });
      try {
        const overlinked = evidence(item);
        return { firstReads, first, hidden, changed, overlinked, payloadReads, excessReads };
      } finally { Object.defineProperty(CharacterData.prototype, "data", data); }
    } finally { window.getComputedStyle = original; }
  }, await build.outputs[0].text());
  assert.equal(result.firstReads, 1, "A snapshot must not repeat computed-style reads for the same link");
  assert.equal(result.first.links[0].label, "First second third");
  assert.equal(result.hidden.links.length, 0, "A subsequent snapshot must observe visibility changes");
  assert.equal(result.hidden.text, "Other text");
  assert.equal(result.changed.links[0].label, "Replacement", "A subsequent snapshot must observe text changes");
  assert.equal(result.overlinked.links.length, 8);
  assert.equal(result.overlinked.complete, false, "Excess links remain explicitly unchecked");
  assert.equal(result.overlinked.ad.known_host, true, "All destination hosts still contribute evidence");
  assert(result.overlinked.text.includes("Link 8"), "Bounding labels must not drop visible target text");
  assert(result.excessReads < result.payloadReads, "Do not extract link labels that cannot enter the payload");
  console.log("PASS: bounded label reads, complete host evidence, and fresh visibility/text snapshots");
} finally { await browser.close(); }

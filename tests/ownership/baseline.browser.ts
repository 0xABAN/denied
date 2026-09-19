/** Baseline audit of the shipping scanner. No provider calls or substituted decisions. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { cases, documentHTML } from "./corpus";

const build = await Bun.build({ entrypoints: ["extension/src/scan.ts"], target: "browser", format: "esm" });
assert(build.success);
const script = await build.outputs[0].text();
const browser = await chromium.launch({ channel: "chromium", headless: true });
const rows = [];
try {
  const page = await browser.newPage();
  for (const test of cases) {
    await page.setContent(documentHTML(test));
    rows.push(await page.evaluate(async ({ script, name }) => {
      const module = await import(URL.createObjectURL(new Blob([script], { type: "text/javascript" })));
      const root = document.querySelector("#fixture")!;
      const candidates = module.discover(root) as HTMLElement[];
      // This independently enumerates text in ordinary light DOM for the baseline check.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const missing = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!node.data.trim() || !node.parentElement || !module.visible(node.parentElement)) continue;
        if (!candidates.some(candidate => candidate.contains(node))) missing.push(node.data.trim());
      }
      return { name, missing, candidates: candidates.map(node => node.id || node.tagName) };
    }, { script, name: test.name }));
  }
} finally {
  await browser.close();
}
const gaps = rows.filter(row => row.missing.length);
console.log(JSON.stringify({ scenarios: cases.length, lightDOMCoverageGaps: gaps }, null, 2));
if (process.argv.includes("--require-coverage")) {
  assert.equal(gaps.length, 0, "Scanner drops rendered text while deduplicating candidate ancestors");
}

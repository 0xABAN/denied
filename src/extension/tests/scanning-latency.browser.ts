/** Compare an in-memory scanner experiment with production on the same live DOM.
 * No production files are changed; no judgments are fabricated or requested.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const treeExperiment = process.env.BENCH_TREE === "1";
const targetFile = treeExperiment ? "src/extension/dom.ts" : "src/extension/scan.ts";
const current = await Bun.file(targetFile).text();
const cached = treeExperiment ? `const root = node instanceof Element && node.shadowRoot ? node.shadowRoot : node;
  const result: Node[] = [];
  for (let child = root.firstChild; child; child = child.nextSibling) result.push(child);
  return result;` : `if (!visibility.has(element)) visibility.set(element, visible(element));
    return visibility.get(element)!;`;
assert(current.includes(cached), "Scanner changed; review the experiment rather than silently skipping it");
const original = current.replace(cached, treeExperiment
  ? "return [...(node instanceof Element && node.shadowRoot ? node.shadowRoot : node).childNodes];"
  : "return visible(element);");
const sources: string[] = [];
for (const optimized of [false, true]) {
  const build = await Bun.build({ entrypoints: ["src/extension/scan.ts"], target: "browser", format: "esm",
    plugins: [{ name: "scanner-experiment", setup(build) {
      build.onLoad({ filter: treeExperiment ? /\/extension\/dom\.ts$/ : /\/extension\/scan\.ts$/ }, () => ({ loader: "ts",
        contents: optimized ? current : original }));
    } }],
  });
  assert(build.success);
  sources.push(await build.outputs[0].text());
}
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  for (const url of ["https://www.youtube.com/results?search_query=black+ops+7", "https://en.wikipedia.org/wiki/Solar_System"]) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const result = await page.evaluate(async ({ sources, treeExperiment }) => {
      const modules: Array<typeof import("../scan")> = [];
      for (const source of sources) {
        const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        modules.push(await import(url));
        URL.revokeObjectURL(url);
      }
      // All measurements below execute synchronously: the host cannot mutate
      // this workload between variants. Ignore module-local identity token values,
      // which are not transmitted; test all provider evidence and coverage flags.
      const targets = modules[0].discover(document.body) as HTMLElement[];
      const times: number[][] = [[], []];
      const comparable = (value: any) => {
        const { media_revisions, ownership_revision, ...rest } = value;
        return rest;
      };
      let equal = true;
      for (let round = 0; round < 10; round++) {
        const values: any[][] = [[], []];
        for (const index of round % 2 ? [1, 0] : [0, 1]) {
          const start = performance.now();
          const currentTargets = treeExperiment ? modules[index].discover(document.body) : targets;
          values[index] = currentTargets.map(target => comparable(modules[index].evidence(target)));
          times[index].push(performance.now() - start);
          equal &&= currentTargets.length === targets.length && currentTargets.every((target, i) => target === targets[i]);
        }
        equal &&= JSON.stringify(values[0]) === JSON.stringify(values[1]);
      }
      return { host: location.hostname, title: document.title, blocks: targets.length, equal, times,
        scope: treeExperiment ? "discovery plus extraction; sibling traversal" : "extraction; visibility reuse" };
    }, { sources, treeExperiment });
    assert(result.equal, "Optimization changed evidence");
    console.log(JSON.stringify(result));
  }
} finally { await browser.close(); }

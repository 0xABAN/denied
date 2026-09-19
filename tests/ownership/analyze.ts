/** Offline development-only threshold analysis of saved real scores; makes no model calls. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { cases } from "./corpus";
import { loadCase, installPrototype } from "./browser";

const path = process.argv[2];
if (!path) throw new Error("Usage: bun tests/ownership/analyze.ts artifacts/ownership-real-<timestamp>.json");
const report = await Bun.file(path).json();
const build = await Bun.build({ entrypoints: ["extension/src/ownership/index.ts"], target: "browser", format: "esm" });
assert(build.success);
const script = await build.outputs[0].text();
const browser = await chromium.launch({ channel: "chromium", headless: true });
const thresholds = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
const totals = thresholds.map(threshold => ({ threshold, cases: 0, exact: 0, collateralCases: 0, incompleteCases: 0 }));
try {
  const page = await browser.newPage();
  for (const row of report.rows.filter((row: any) => row.split === "development" && !row.error)) {
    const test = cases.find(test => test.name === row.name)!;
    await loadCase(page, test, row.variant);
    await installPrototype(page, script);
    const results = await page.evaluate(({ scores, roots, thresholds, flagged }) => {
      const { ownership: api, findFixture: find } = window as any;
      const snapshot = api.observe(find("fixture"));
      const expected = snapshot.atoms.filter((id: string) => roots.some(root => api.contains(find(root), snapshot.refs.get(id))));
      const seed = snapshot.atoms.filter((id: string) => api.contains(find("seed"), snapshot.refs.get(id)));
      if (snapshot.atoms.some((id: string) => typeof scores[id] !== "number")) throw new Error("Observation does not match saved scores");
      return thresholds.map(threshold => {
        const approved = flagged ? snapshot.atoms.filter((id: string) => seed.includes(id) || scores[id] >= threshold) : [];
        const plan = api.planRemoval(snapshot, approved);
        // Evaluate the physical scope of this real plan without modifying the DOM.
        const covered = snapshot.atoms.filter((id: string) => plan.roots.some((root: string) => api.contains(snapshot.refs.get(root), snapshot.refs.get(id))));
        const collateral = covered.some((id: string) => !expected.includes(id));
        const incomplete = expected.some((id: string) => !covered.includes(id));
        return { collateral, incomplete, exact: !collateral && !incomplete };
      });
    }, { scores: row.ownershipScores, roots: test.roots, thresholds, flagged: row.flagged });
    for (const [index, result] of results.entries()) {
      totals[index].cases++;
      totals[index].exact += Number(result.exact);
      totals[index].collateralCases += Number(result.collateral);
      totals[index].incompleteCases += Number(result.incomplete);
    }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ source: path, split: "development-only", promptHash: report.promptHash,
  note: "Diagnostic trade-offs, not a calibrated threshold or a new held-out evaluation.", totals }, null, 2));

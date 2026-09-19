/** Candidate recall and scope validity, independently of model accuracy. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { cases, variants } from "./corpus";
import { challenges } from "./challenge";
import { installPrototype, loadCase } from "./browser";

const build = await Bun.build({ entrypoints: ["extension/src/ownership/index.ts"], target: "browser", format: "esm" });
assert(build.success);
const script = await build.outputs[0].text();
const browser = await chromium.launch({ channel: "chromium", headless: true });
const missing = [];
let checked = 0;
let maximumOptions = 0;
try {
  const page = await browser.newPage();
  for (const test of [...cases, ...challenges]) {
    for (const variant of variants) {
      await loadCase(page, test, variant);
      await installPrototype(page, script);
      const result = await page.evaluate(({ roots, remove }) => {
        const { ownership: api, findFixture: find } = window as any;
        if (typeof api.proposePlans !== "function") return { implemented: false };
        const observation = api.observe(find("fixture"));
        const proposed = api.proposePlans(observation, find("seed"));
        const expected = observation.atoms.filter((id: string) => roots.some(root => api.contains(find(root), observation.refs.get(id))));
        const match = proposed.options.some((option: any) => option.atoms.length === expected.length &&
          option.atoms.every((id: string) => expected.includes(id)));
        const seedAtoms = observation.atoms.filter((id: string) => api.contains(find("seed"), observation.refs.get(id)));
        const valid = proposed.options.every((option: any) => option.atoms.length === 0 ||
          (seedAtoms.every((id: string) => option.atoms.includes(id)) && api.planRemoval(observation, option.atoms).valid));
        const empty = proposed.options.some((option: any) => option.atoms.length === 0);
        const unique = new Set(proposed.options.map((option: any) => [...option.atoms].sort().join(","))).size === proposed.options.length;
        return { implemented: true, match, valid, empty, unique, complete: proposed.complete,
          options: proposed.options.length, expected: expected.length, requiresRemoval: remove };
      }, { roots: test.roots, remove: test.remove });
      assert.equal(result.implemented, true, "Whole-plan candidate generation is not implemented");
      assert(result.valid && result.empty && result.unique && result.complete, `${test.name}/${variant}: invalid candidate pool`);
      if (!result.match) missing.push({ name: test.name, variant, ...result });
      maximumOptions = Math.max(maximumOptions, result.options!);
      checked++;
    }
  }
  await loadCase(page, cases.find(test => test.name === "message-with-private-composer")!);
  await installPrototype(page, script);
  const boundaries = await page.evaluate(() => {
    const { ownership: api, findFixture: find } = window as any;
    const observation = api.observe(find("fixture"));
    const summarize = (pool: any) => ({ complete: pool.complete, count: pool.options.length });
    return {
      privateAnchor: summarize(api.proposePlans(observation, document.querySelector("textarea"))),
      outsideAnchor: summarize(api.proposePlans(observation, document.body)),
      capped: summarize(api.proposePlans(observation, find("seed"), 2)),
      invalidCap: summarize(api.proposePlans(observation, find("seed"), 1)),
    };
  });
  assert.deepEqual(boundaries.privateAnchor, { complete: false, count: 1 }, "An unobservable private anchor cannot authorize expansion");
  assert.deepEqual(boundaries.outsideAnchor, { complete: false, count: 1 });
  assert.deepEqual(boundaries.capped, { complete: false, count: 2 });
  assert.deepEqual(boundaries.invalidCap, { complete: false, count: 1 });
  console.log(JSON.stringify({ checked, candidateRecall: checked - missing.length, maximumOptions, missing }, null, 2));
  assert.equal(missing.length, 0, "The correct removal cannot be selected if no candidate covers it");
} finally {
  await browser.close();
}

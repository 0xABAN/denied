/** End-to-end experiment: actual Chromium observations -> real Jev -> guarded DOM deletion. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { cases, variants, type Variant } from "./corpus";
import { challenges } from "./challenge";
import { installPrototype, loadCase } from "./browser";

const build = await Bun.build({ entrypoints: ["extension/src/ownership/index.ts"], target: "browser", format: "esm" });
assert(build.success);
const script = await build.outputs[0].text();
const usePlans = process.argv.includes("--plans");
const classifyScopes = process.argv.includes("--classify-scopes");
const splitContexts = process.argv.includes("--split-contexts");
const useRelations = process.argv.includes("--relations");
const membershipCutoff = Number(process.argv.find(arg => arg.startsWith("--membership-cutoff="))?.split("=")[1] ?? "0.5");
assert(Number.isFinite(membershipCutoff) && membershipCutoff >= 0 && membershipCutoff <= 1,
  "Membership cutoff must be between zero and one");
assert(!classifyScopes || usePlans, "Scoped classification requires --plans");
assert(!splitContexts || (usePlans && classifyScopes), "Split contexts require --plans --classify-scopes");
assert(!useRelations || splitContexts, "Relation experiments require --split-contexts");
const selectedVariants: readonly Variant[] = process.argv.includes("--original-only") ? ["original"] : variants;
const corpus = process.argv.includes("--challenge-only") ? challenges : cases;
const selectedCases = process.argv.includes("--development-only") ? corpus.filter(test => test.split === "development") : corpus;
const jobs = selectedCases.flatMap(test => selectedVariants.map(variant => ({ test, variant })));
const browser = await chromium.launch({ channel: "chromium", headless: true });
const samples: any[] = [];
const rows: any[] = [];
const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};
try {
  const page = await browser.newPage();
  for (const { test, variant } of jobs) {
    await loadCase(page, test, variant);
    await installPrototype(page, script);
    samples.push(await page.evaluate(baseline => {
      const { ownership: api, findFixture: find } = window as any;
      const snapshot = api.observe(find("fixture"));
      if (!snapshot.complete) throw new Error("Incomplete benchmark observation");
      const seed = find("seed");
      const anchorId = [...snapshot.refs].find(([, node]) => node === seed)![0];
      const seedAtoms = snapshot.atoms.filter((id: string) => api.contains(seed, snapshot.refs.get(id)));
      const proposed = api.proposePlans(snapshot, seed);
      if (!proposed.complete) throw new Error("Incomplete candidate enumeration");
      const text = snapshot.data.nodes.filter((node: any) => node.kind === "text" && api.contains(seed, snapshot.refs.get(node.id)))
        .map((node: any) => node.text).join(" ");
      return { baseline, observation: snapshot.data, anchor_id: anchorId, atoms: snapshot.atoms, seedAtoms, plans: proposed.options,
        candidate: { text, links: [], ad: { tag: seed.tagName.toLowerCase(), tokens: "", label: "", source_host: "",
          source_scheme: "", known_host: false, attributes: [], network: "" } } };
    }, variant === "original"));
  }

  console.log(`Evaluating ${selectedCases.length} authored scenarios × ${selectedVariants.length} variants with real Jev.`);
  const child = Bun.spawn(["uv", "run", "--env-file", ".env", "python", "benchmark_ownership.py",
    ...(usePlans ? ["--plans"] : []), ...(classifyScopes ? ["--classify-scopes"] : []),
    ...(splitContexts ? ["--split-contexts"] : []), ...(useRelations ? ["--relations"] : [])], {
    cwd: resolve("backend"), stdin: "pipe", stdout: "pipe", stderr: "inherit",
  });
  child.stdin.write(JSON.stringify(samples));
  child.stdin.end();
  const output = await new Response(child.stdout).text();
  assert.equal(await child.exited, 0, "Real provider runner failed");
  const provider = JSON.parse(output);
  const predictions = new Map<number, any>(provider.results.filter((row: any) => row.ownership).map((row: any) => [row.index, row]));

  for (let index = 0; index < jobs.length; index++) {
    const { test, variant } = jobs[index];
    const prediction = predictions.get(index);
    if (!prediction || prediction.error) {
      rows.push({ name: test.name, family: test.family, split: test.split, variant, error: prediction?.error || "MissingResult" });
      continue;
    }
    await loadCase(page, test, variant);
    await installPrototype(page, script);
    const result = await page.evaluate(({ sample, prediction, threshold, expectedRoots, keep, usePlans, classifyScopes,
      useRelations, membershipCutoff }) => {
      const { ownership: api, findFixture: find } = window as any;
      const snapshot = api.observe(find("fixture"));
      if (JSON.stringify(snapshot.atoms) !== JSON.stringify(sample.atoms)) throw new Error("Replayed observation IDs changed");
      const expectedNodes = expectedRoots.map(id => find(id) as Node);
      const keepNodes = keep.map(id => find(id) as Node);
      const expected = snapshot.atoms.filter((id: string) => expectedNodes.some(root => api.contains(root, snapshot.refs.get(id))));
      const related = useRelations ? snapshot.atoms.filter((id: string) => sample.seedAtoms.includes(id) ||
        (prediction.relations[id].choice === "same_item" &&
         prediction.relations[id].probabilities.same_item >= membershipCutoff)) : [];
      const matched = useRelations ? sample.plans.find((option: any) => option.atoms.length === related.length &&
        option.atoms.every((id: string) => related.includes(id))) : null;
      const seedScope = sample.plans.find((option: any) => option.atoms.length === sample.seedAtoms.length &&
        option.atoms.every((id: string) => sample.seedAtoms.includes(id)));
      // Do not override a rejected association with an unrelated whole-scope choice.
      // An unrepresented mask falls back to the seed and is explicitly reported.
      const appliedScope = useRelations ? (matched?.id ?? seedScope.id) : prediction.scope;
      const scores = classifyScopes && appliedScope !== "none" ? prediction.scope_scores[appliedScope] :
        { ad: prediction.ad_score, unsafe: prediction.unsafe_score };
      const flagged = scores.ad >= 0.7 || scores.unsafe >= 0.8;
      const selectedScope = sample.plans.find((option: any) => option.id === appliedScope);
      const owned = usePlans ? (appliedScope === "none" ? sample.seedAtoms : selectedScope.atoms) :
        snapshot.atoms.filter((id: string) => sample.seedAtoms.includes(id) || prediction.scores[id] >= threshold);
      const approved = flagged ? owned : [];
      const plan = api.planRemoval(snapshot, approved);
      const chosenRoots = plan.roots.map((id: string) => {
        const node = snapshot.refs.get(id);
        return node instanceof Element ? node.id || node.tagName : "#text";
      });
      const committed = api.commitRemoval(plan, () => true);
      const removed = snapshot.atoms.filter((id: string) => !snapshot.refs.get(id).isConnected);
      const collateral = removed.filter((id: string) => !expected.includes(id));
      const missed = expected.filter((id: string) => !removed.includes(id));
      return { flagged, appliedScope, relationMaskRepresentable: useRelations ? !!matched : null,
        relationExact: useRelations && expected.length ? related.length === expected.length && related.every((id: string) => expected.includes(id)) : null,
        exact: collateral.length === 0 && missed.length === 0 && !committed.cancelled,
        expectedAtomIds: expected, removedAtomIds: removed, seedAtomIds: sample.seedAtoms,
        expectedAtoms: expected.length, removedAtoms: removed.length, collateralAtoms: collateral.length,
        missedAtoms: missed.length, keptExplicitNeighbors: keepNodes.every(node => node.isConnected),
        wholeExpectedContainersRemoved: expectedNodes.every(node => !node.isConnected), chosenRoots,
        committed, ownershipExact: expected.length > 0 ? owned.length === expected.length && owned.every((id: string) => expected.includes(id)) : null,
        mistakes: [...collateral.map((id: string) => ({ id, kind: "collateral", node: snapshot.data.nodes.find((node: any) => node.id === id) })),
          ...missed.map((id: string) => ({ id, kind: "missed", node: snapshot.data.nodes.find((node: any) => node.id === id) }))] };
    }, { sample: samples[index], prediction, threshold: provider.ownership_threshold,
      expectedRoots: test.roots, keep: test.keep, usePlans, classifyScopes, useRelations, membershipCutoff });
    rows.push({ name: test.name, family: test.family, split: test.split, variant, expectedRemove: test.remove,
      classificationCorrect: result.flagged === test.remove, ...result,
      latencyMs: prediction.latency_ms, requestBytes: prediction.request_bytes, questions: prediction.questions,
      requests: prediction.requests, requestHash: prediction.request_hash,
      adScore: prediction.ad_score, unsafeScore: prediction.unsafe_score, ownershipScores: prediction.scores,
      scope: prediction.scope, scopeConfidence: prediction.confidence, scopeProbabilities: prediction.probabilities,
      collateralScores: prediction.collateral_scores, scopeScores: prediction.scope_scores, relations: prediction.relations });
  }

  const summarize = (subset: any[]) => ({
    cases: subset.length, errors: subset.filter(row => row.error).length,
    exact: subset.filter(row => row.exact).length,
    classificationCorrect: subset.filter(row => row.classificationCorrect).length,
    collateralCases: subset.filter(row => row.collateralAtoms > 0).length,
    incompleteCases: subset.filter(row => row.missedAtoms > 0).length,
    medianMs: percentile(subset.filter(row => !row.error).map(row => row.latencyMs), 0.5),
    p95Ms: percentile(subset.filter(row => !row.error).map(row => row.latencyMs), 0.95),
  });
  const baseline = provider.results.filter((row: any) => !row.ownership);
  const summary = {
    authoredScenarios: selectedCases.length, variants: selectedVariants.length,
    original: summarize(rows.filter(row => row.variant === "original")),
    development: summarize(rows.filter(row => row.split === "development")),
    holdout: summarize(rows.filter(row => row.split === "holdout")),
    all: summarize(rows),
    classificationOnly: { calls: baseline.length, errors: baseline.filter((row: any) => row.error).length,
      medianMs: percentile(baseline.filter((row: any) => !row.error).map((row: any) => row.latency_ms), 0.5),
      p95Ms: percentile(baseline.filter((row: any) => !row.error).map((row: any) => row.latency_ms), 0.95) },
  };
  const artifact = resolve(`artifacts/ownership-${usePlans ? "plans" : "real"}-${Date.now()}.json`);
  await Bun.write(artifact, JSON.stringify({ date: new Date().toISOString(), model: provider.model,
    promptHash: provider.prompt_hash, strategy: provider.strategy, ownershipThreshold: provider.ownership_threshold,
    membershipCutoff: useRelations ? membershipCutoff : null,
    limitations: "Synthetic authored labels. Split names record corpus origins: both original holdouts and challenges have now been inspected during iterative development, so neither is an untouched evaluation. Singleton fixtures, possibly two parallel requests per fixture; not production 20-item/600-block throughput.",
    summary, rows, baseline }, null, 2));
  console.log(JSON.stringify({ artifact, summary }, null, 2));
  if (rows.some(row => row.error || !row.exact) || baseline.some((row: any) => row.error)) process.exitCode = 1;
} finally {
  await browser.close();
}

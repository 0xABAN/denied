// Opt-in evaluation. Sends only the synthetic cases below through the running Python API.
import assert from "node:assert/strict";
import { judgmentsFrom, type Batch } from "../contracts";
import { apiBase } from "../settings";

const base = apiBase(process.env.DENIED_API_URL || "http://127.0.0.1:8765");
const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
if (!health.configured) throw new Error("Set TYPESAFE_API_KEY in the backend environment and restart the API first.");
const cases = await Bun.file("src/backend/tests/cases.json").json() as { name: string; text: string; label: string; ad: boolean; unsafe: boolean; links?: Batch["candidates"][number]["links"] }[];
const batch: Batch = {
  document_id: "live-evaluation", page_host: "controlled-fixture.test", page_scheme: "http",
  candidates: cases.map((c, i) => ({ id: String(i), revision: 1, text: c.text, links: c.links || [],
    ad: { tag: "p", tokens: "", label: c.label, source_host: "", source_scheme: "", known_host: false } })),
};
const started = performance.now();
const response = await fetch(`${base}/judge`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch), signal: AbortSignal.timeout(10000),
});
assert(response.ok, `API returned ${response.status}; no live accuracy result available`);
const body = judgmentsFrom(await response.json(), batch);
let mismatches = 0;
for (const result of body.results) {
  const expected = cases[Number(result.id)];
  const correct = result.reasons.includes("advertising") === expected.ad && result.reasons.includes("unsafe_content") === expected.unsafe;
  if (!correct) mismatches++;
  console.log(`${correct ? "PASS" : "FAIL"} ${expected.name}: ad=${result.ad_score.toFixed(3)} unsafe=${result.unsafe_score.toFixed(3)} violent_entity=${result.violent_entity_score.toFixed(3)}`);
}
console.log(`${cases.length - mismatches}/${cases.length} cases; ${Math.round(performance.now() - started)}ms API round trip. This small fixture is not a general safety benchmark.`);
assert.equal(mismatches, 0, "Live judgments differed from the fixture labels; review errors before changing thresholds.");

// Actual Chromium -> FastAPI -> Jev -> Tiger Data, isolated in a disposable DB schema.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import type { Batch, Judgments, PageStats, Removal } from "../extension/src/contracts";
import { localAPI, until } from "./api";
import { observeJudgments } from "./observe-judgments";

const token = Bun.env.BACKEND_API_TOKEN;
assert(token && token.length >= 32, "Configure BACKEND_API_TOKEN; real storage tests cannot run without it");
assert(Bun.env.PGHOST || Bun.env.TIGER_DATABASE_URL || Bun.env.TIMESCALE_SERVICE_URL, "A real Tiger database is required");
const schema = `denied_test_${crypto.randomUUID().replaceAll("-", "")}`;
const profile = await mkdtemp(join(tmpdir(), "denied-tiger-"));
const site = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(Bun.file("tests/page.html")) });
const pageUrl = `http://127.0.0.1:${site.port}/`;
const SCAM = "Your bank account will be deleted in ten minutes. Reply with your password and verification code so our agent can save it.";
let api: Awaited<ReturnType<typeof localAPI>> | undefined;
let context: BrowserContext | undefined;
let observer: ReturnType<typeof observeJudgments> | undefined;
const reports: Removal[] = [];
const evaluated: { batch: Batch; result: Judgments }[] = [];
let captureFailed = false;

async function query(path: string) {
  const response = await fetch(`${api!.url}${path}`, { headers: { "X-Backend-Token": token! } });
  assert.equal(response.status, 200, `Storage read returned ${response.status}`);
  return response.json();
}
async function rows(): Promise<any[]> { return (await query("/removals?limit=100")).items; }
async function judgments(): Promise<any[]> { return (await query("/judgments?limit=100")).items; }
function singleDate(row: any) {
  assert(Number.isFinite(Date.parse(row.date)));
  assert(!/"(?:detected_at|judged_at|removed_at|recorded_at)"/.test(JSON.stringify(row)), "Legacy timestamp field remained");
}

async function database(action: "legacy" | "metadata" | "cleanup") {
  // All schema-changing checks are confined to this run's disposable namespace.
  const process = Bun.spawn(["uv", "run", "--env-file", ".env", "python", "-c", `
import os, re, sys
from psycopg import sql
from denied.telemetry import connect, table
name = os.environ['DENIED_DB_SCHEMA']
assert re.fullmatch(r'denied_test_[a-f0-9]{32}', name)
with connect() as connection:
    if sys.argv[1] in ('legacy', 'metadata'):
        # Exercise both historical schemas using real removal rows, not substituted judgments.
        if sys.argv[1] == 'legacy':
            connection.execute(sql.SQL('''
                ALTER TABLE {table} RENAME COLUMN date TO removed_at;
                ALTER TABLE {table} ADD COLUMN detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                   ADD COLUMN judged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                                   ADD COLUMN recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
                ALTER TABLE {judgments} DROP COLUMN violent_entity_score;
            ''').format(table=table(), judgments=table('judgments')))
        connection.execute(sql.SQL('''
            UPDATE {table} SET classifications = (
                SELECT jsonb_agg(item || jsonb_build_object(
                    'judged_at', NOW(), 'remove', true, 'policy_version', '5',
                    'model_version', 'jev-latest', 'judge_ms', judge_ms
                )) FROM jsonb_array_elements(classifications) AS item
            );
        ''').format(table=table()))
    else:
        connection.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(name)))
`, action], { cwd: resolve("backend"), env: { ...Bun.env, DENIED_DB_SCHEMA: schema }, stdout: "ignore", stderr: "ignore" });
  assert.equal(await process.exited, 0, `Database ${action} failed in test schema ${schema}`);
}
async function post(value: unknown) {
  return fetch(`${api!.url}/outcomes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

try {
  api = await localAPI({ DENIED_DB_SCHEMA: schema, DENIED_RECORD_HISTORY: "1" });
  const health = await fetch(`${api.url}/health`).then(r => r.json());
  assert.equal(health.recording_enabled, true);
  assert.equal(health.recording_error, null, "Real database initialization failed");
  assert.equal((await fetch(`${api.url}/removals`)).status, 401);
  assert.equal((await fetch(`${api.url}/metrics`)).status, 401);
  assert.equal((await fetch(`${api.url}/judgments`)).status, 401);
  assert.equal((await rows()).length, 0);
  assert.equal((await judgments()).length, 0);

  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1100, height: 900 },
    env: { PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: tmpdir() },
    args: [`--disable-extensions-except=${resolve("dist")}`, `--load-extension=${resolve("dist")}`],
  });
  context.on("request", request => {
    if (request.url() === `${observer!.url}/outcomes`) reports.push(request.postDataJSON());
  });
  observer = observeJudgments(api.url, batch => batch, (batch, status, result) => {
    if (status === 200 && result) evaluated.push({ batch, result });
    else captureFailed = true;
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("details summary").click();
  await popup.locator("#apiBase").fill(observer.url);
  await popup.locator("#save").click();
  await popup.waitForFunction(() => document.querySelector("#service-status")?.textContent?.includes("API ready"));
  await page.goto(pageUrl);
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url)?.id, pageUrl);
  assert(tab !== undefined);
  const stats = (): Promise<PageStats> => worker.evaluate(id => chrome.tabs.sendMessage(id, { type: "pageStats" }), tab);
  const add = (id: string, text: string) => page.evaluate(({ id, text }) => {
    const p = document.createElement("p"); p.id = id; p.className = "sample"; p.textContent = text;
    document.body.append(p);
  }, { id, text });

  await until(async () => Boolean(await stats().catch(() => null)), "content script ready");
  await popup.locator("#enabled").check();
  await page.bringToFront();
  await page.waitForSelector("#ad-card", { state: "detached" });
  await page.waitForSelector("#unsafe", { state: "detached" });
  await until(async () => (await rows()).length === 2, "actual removal rows persisted in Tiger");
  const initial = await rows();
  assert(initial.some(row => row.removed_text === SCAM && row.reasons.includes("unsafe_content")));
  assert(initial.some(row => row.reasons.includes("advertising")));
  assert(!JSON.stringify(initial).includes("DO_NOT_SEND"));
  for (const row of initial) {
    assert.equal(row.page_host, "127.0.0.1");
    assert.equal(row.page_scheme, "http");
    assert(row.total_ms >= 1200 && row.judge_ms >= 0);
    singleDate(row);
    assert(row.classifications.length > 0);
    for (const item of row.classifications) {
      assert.deepEqual(Object.keys(item).sort(), ["id", "revision", "text", "ad_score", "unsafe_score", "violent_entity_score", "reasons", "ad_threshold", "safety_threshold"].sort());
      assert(item.reasons.length > 0);
    }
  }
  console.log("PASS: actual removals, passage scores, a single date and latency persist in Tiger; inputs stay excluded");

  await until(async () => (await stats()).pending === 0, "initial judgments settled");
  assert(evaluated.length > 0 && !captureFailed);
  const expectedCount = evaluated.reduce((sum, item) => sum + item.batch.candidates.length, 0);
  await until(async () => (await judgments()).length === expectedCount, "every judged passage persisted");
  const saved = await judgments();
  assert(saved.some(row => row.decision === "keep"));
  assert(saved.some(row => row.decision === "remove"));
  assert(!JSON.stringify(saved).includes("DO_NOT_SEND"));
  for (const { batch, result } of evaluated) {
    for (const candidate of batch.candidates) {
      const row = saved.find(row => row.document_id === batch.document_id && row.candidate_id === candidate.id && row.revision === candidate.revision);
      const decision = result.results.find(item => item.id === candidate.id)!;
      assert(row && row.text === candidate.text);
      assert.equal(row.ad_score, decision.ad_score);
      assert.equal(row.unsafe_score, decision.unsafe_score);
      assert.equal(row.violent_entity_score, decision.violent_entity_score);
      assert.equal(row.decision, decision.remove ? "remove" : "keep");
      assert(JSON.stringify(row.links) === JSON.stringify(candidate.links));
      assert.equal(row.page_host, batch.page_host);
      assert.equal(row.policy_version, result.policy_version);
      assert.equal(row.model_version, "jev-latest");
      singleDate(row);
    }
  }
  const kept = (await query("/judgments?decision=keep&limit=100")).items;
  assert(kept.length > 0 && kept.every((row: any) => row.decision === "keep"));
  assert.equal((await query("/metrics")).total_judgments, expectedCount);
  console.log("PASS: every kept and flagged passage matches the actual API judgment; kept cases are queryable");

  assert(reports.length >= 2);
  assert.equal((await post(reports[0])).status, 200);
  assert.equal((await rows()).length, 2, "Duplicate delivery created another row");
  const wrongText = structuredClone(reports[0]); wrongText.passages[0].text += "tampered";
  assert.equal((await post(wrongText)).status, 403);
  const wrongSignature = structuredClone(reports[0]);
  const receipt = wrongSignature.passages[0].receipt;
  wrongSignature.passages[0].receipt = receipt.slice(0, -1) + (receipt.endsWith("a") ? "b" : "a");
  assert.equal((await post(wrongSignature)).status, 403);
  assert.equal((await post({ ...reports[0], ad_score: 1 })).status, 422);
  assert.equal((await rows()).length, 2);
  console.log("PASS: server-owned classifications cannot be tampered with; duplicate reports are idempotent; reads require a token");

  await popup.locator("#mode").selectOption("highlight");
  await add("history-highlight", SCAM);
  await page.waitForSelector("#history-highlight [data-denied-ui]");
  assert.equal((await rows()).length, 2, "Highlighting was counted as removal");
  await until(async () => (await judgments()).filter(row => row.text === SCAM).length >= 2, "highlight judgment recorded without a removal");
  await page.locator("#history-highlight").evaluate(el => el.remove());
  await popup.locator("#mode").selectOption("remove");
  await page.bringToFront();
  await add("history-stale", SCAM);
  await page.waitForFunction(() => !!document.querySelector("#history-stale")?.getAnimations().length);
  await page.locator("#history-stale").evaluate(el => { el.textContent = "The library reading group meets on Saturday."; });
  await until(async () => (await stats()).pending === 0, "changed target rechecked");
  assert.equal(await page.locator("#history-stale").count(), 1);
  assert.equal((await rows()).length, 2, "A canceled removal was recorded");
  await until(async () => (await judgments()).some(row => row.text === "The library reading group meets on Saturday." && row.decision === "keep"), "revised benign judgment recorded");
  console.log("PASS: highlights and stale/canceled decisions do not create removal records");

  await add("history-both", "Sponsored. Join our online casino and place real-money bets to win cash prizes.");
  await page.waitForSelector("#history-both", { state: "detached" });
  await until(async () => (await rows()).length === 3, "dual-filter record persisted");
  assert((await rows()).some(row => row.reasons.length === 2));
  const metrics = await query("/metrics");
  assert.equal(metrics.total_removals, 3);
  assert.equal(metrics.advertising, 2);
  assert.equal(metrics.unsafe_content, 2);
  const beforeMigration = await rows();
  const judgmentsBeforeRestart = (await judgments()).length;
  for (const format of ["legacy", "metadata"] as const) {
    await api.stop();
    await database(format);
    await api.start();
    const migrated = await rows();
    assert.equal(migrated.length, 3, "Records did not survive migration/restart");
    for (const row of migrated) {
      singleDate(row);
      const previous = beforeMigration.find(previous => previous.event_id === row.event_id)!;
      assert.equal(row.date, previous.date);
      assert.equal(row.removed_text, previous.removed_text);
      assert.equal(row.judge_ms, previous.judge_ms);
      assert(JSON.stringify(row.classifications) === JSON.stringify(previous.classifications));
    }
    const oldJudgments = await judgments();
    assert.equal(oldJudgments.length, judgmentsBeforeRestart);
    assert(oldJudgments.every(row => row.violent_entity_score === null), "Pre-column judgments must remain unassessed, not safe/zero");
  }
  console.log("PASS: legacy schemas migrate without losing stored content or scores; new entity column leaves historical rows null");

  // Use a real refused TCP connection, not a substituted database client.
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const unavailablePort = reservation.port!; reservation.stop(true);
  await api.stop();
  await api.start({ PGHOST: "127.0.0.1", PGPORT: String(unavailablePort) });
  await add("history-outage", SCAM);
  await page.waitForSelector("#history-outage", { state: "detached" });
  await until(async () => Boolean((await stats()).recording_error), "database failure reported separately");
  assert.equal((await stats()).error, null, "Database outage disabled checking");
  await api.stop();
  await api.start();
  assert.equal((await rows()).length, 3);
  await add("history-recovered", SCAM);
  await page.waitForSelector("#history-recovered", { state: "detached" });
  await until(async () => (await rows()).length === 4, "recording recovered with actual Tiger connection");
  console.log("PASS: real database connection failure does not prevent filtering; recording recovers");

  await add("history-entity", "Black Ops 7");
  await page.waitForSelector("#history-entity", { state: "detached" });
  await until(async () => (await rows()).length === 5, "entity-only removal persisted");
  const entity = (await rows()).find(row => row.removed_text === "Black Ops 7");
  assert.deepEqual(entity.reasons, ["unsafe_content"]);
  assert(entity.classifications.some((item: any) => item.violent_entity_score >= 0.80));
  await until(async () => (await judgments()).some(row => row.text === "Black Ops 7" && row.violent_entity_score >= 0.80), "new entity score stored after schema upgrade");
  const finalMetrics = await query("/metrics");
  assert.equal(finalMetrics.total_removals, 5);
  assert.equal(finalMetrics.unsafe_content, 4);
  console.log("PASS: separate entity scores persist in judgments and signed removals and count once under unsafe content");
} finally {
  await context?.close();
  site.stop(true);
  await api?.stop();
  observer?.stop();
  await rm(profile, { recursive: true, force: true });
  await database("cleanup");
}
console.log("Real Tiger Data integration checks passed; disposable schema removed.");

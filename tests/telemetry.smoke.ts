// Actual Chromium -> FastAPI -> Jev -> Tiger Data, isolated in a disposable DB schema.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import type { PageStats, Removal } from "../extension/src/contracts";
import { localAPI, until } from "./api";

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
const reports: Removal[] = [];

async function query(path: string) {
  const response = await fetch(`${api!.url}${path}`, { headers: { "X-Backend-Token": token! } });
  assert.equal(response.status, 200, `Storage read returned ${response.status}`);
  return response.json();
}
async function rows(): Promise<any[]> { return (await query("/removals?limit=100")).items; }
async function post(value: unknown) {
  return fetch(`${api!.url}/outcomes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

try {
  api = await localAPI({ DENIED_DB_SCHEMA: schema, DENIED_RECORD_REMOVALS: "1" });
  const health = await fetch(`${api.url}/health`).then(r => r.json());
  assert.equal(health.recording_enabled, true);
  assert.equal(health.recording_error, null, "Real database initialization failed");
  assert.equal((await fetch(`${api.url}/removals`)).status, 401);
  assert.equal((await fetch(`${api.url}/metrics`)).status, 401);
  assert.equal((await rows()).length, 0);

  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, viewport: { width: 1100, height: 900 },
    env: { PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: tmpdir() },
    args: [`--disable-extensions-except=${resolve("dist")}`, `--load-extension=${resolve("dist")}`],
  });
  context.on("request", request => {
    if (request.url() === `${api!.url}/outcomes`) reports.push(request.postDataJSON());
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator("details summary").click();
  await popup.locator("#apiBase").fill(api.url);
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
    for (const field of ["recorded_at", "detected_at", "judged_at", "removed_at"]) assert(Number.isFinite(Date.parse(row[field])));
    assert(row.classifications.every((item: any) => item.remove && item.model_version === "jev-latest" && item.policy_version === "5"));
    assert(!("receipt" in row.classifications[0]));
  }
  console.log("PASS: actual removals, passage scores, timestamps and latency persist in Tiger; inputs stay excluded");

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
  await page.locator("#history-highlight").evaluate(el => el.remove());
  await popup.locator("#mode").selectOption("remove");
  await page.bringToFront();
  await add("history-stale", SCAM);
  await page.waitForFunction(() => !!document.querySelector("#history-stale")?.getAnimations().length);
  await page.locator("#history-stale").evaluate(el => { el.textContent = "The library reading group meets on Saturday."; });
  await until(async () => (await stats()).pending === 0, "changed target rechecked");
  assert.equal(await page.locator("#history-stale").count(), 1);
  assert.equal((await rows()).length, 2, "A canceled removal was recorded");
  console.log("PASS: highlights and stale/canceled decisions do not create removal records");

  await add("history-both", "Sponsored. Join our online casino and place real-money bets to win cash prizes.");
  await page.waitForSelector("#history-both", { state: "detached" });
  await until(async () => (await rows()).length === 3, "dual-filter record persisted");
  assert((await rows()).some(row => row.reasons.length === 2));
  const metrics = await query("/metrics");
  assert.equal(metrics.total_removals, 3);
  assert.equal(metrics.advertising, 2);
  assert.equal(metrics.unsafe_content, 2);
  await api.stop();
  await api.start();
  assert.equal((await rows()).length, 3, "Records did not survive process restart");
  console.log("PASS: a dual classification produces one row; aggregate metrics and restart persistence match Tiger data");

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
} finally {
  await context?.close();
  site.stop(true);
  await api?.stop();
  await rm(profile, { recursive: true, force: true });
  // Delete only this run's namespace. Never delete from the user's production schema.
  const cleanup = Bun.spawn(["uv", "run", "--env-file", ".env", "python", "-c", `
import os, re
from psycopg import sql
from denied.telemetry import connect
name = os.environ['DENIED_DB_SCHEMA']
assert re.fullmatch(r'denied_test_[a-f0-9]{32}', name)
with connect() as connection:
    connection.execute(sql.SQL('DROP SCHEMA IF EXISTS {} CASCADE').format(sql.Identifier(name)))
`], { cwd: resolve("backend"), env: { ...Bun.env, DENIED_DB_SCHEMA: schema }, stdout: "ignore", stderr: "ignore" });
  assert.equal(await cleanup.exited, 0, `Could not clean test schema ${schema}`);
}
console.log("Real Tiger Data integration checks passed; disposable schema removed.");

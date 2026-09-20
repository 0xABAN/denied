/** A loaded Gmail page must dispatch every row before waiting for a judgment.
 * Synthetic mail only; the built extension and Jev responses are unmodified.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Batch, Judgments } from "../contracts";
import { localAPI, until } from "./api";
import { launchExtension } from "./browser";
import { observeJudgments } from "./observe-judgments";

const directory = await mkdtemp(join(tmpdir(), "noped-gmail-wave-"));
const key = join(directory, "fixture.key");
const cert = join(directory, "fixture.crt");
const openssl = Bun.spawn(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-subj", "/CN=noped-synthetic-gmail", "-keyout", key, "-out", cert], { stdout: "ignore", stderr: "ignore" });
assert.equal(await openssl.exited, 0);
const api = await localAPI();
const observations: { batch: Batch; started: number; finished?: number; status?: number; result?: Judgments }[] = [];
const observer = observeJudgments(api.url, batch => {
  const record = { batch, started: performance.now() } as typeof observations[number];
  observations.push(record);
  return record;
}, (record, status, result) => Object.assign(record, { status, result, finished: performance.now() }));

const rowCount = 50;
const html = `<!doctype html><title>Synthetic Gmail wave</title><style>
  body { margin:40px;font:14px system-ui } table { width:900px;border-spacing:0 }
  tr { height:40px;background:#eee } td { padding:4px }
  </style><nav id="navigation">Mailbox navigation</nav><table><tbody>
  ${Array.from({ length: rowCount }, (_, index) => `<tr class="zA" data-row="${index}">
    <td><input type="checkbox" aria-label="Select message"></td><td>Example sender</td>
    <td class="y6"><span class="bog">${index < 45 ? "Tickets for sale" : "School garden update"}</span>
    <span class="y2">${index < 45 ? "Send me a message to buy tickets for $40." : "The flowers and butterflies look beautiful today."} Message ${index}.</span></td>
    </tr>`).join("")}</tbody></table>
  <form id="composer"><textarea>DO_NOT_SEND_DRAFT</textarea></form>`;
let fixtureRequests = 0;
const site = Bun.serve({ hostname: "127.0.0.1", port: 0,
  tls: { key: Bun.file(key), cert: Bun.file(cert) }, fetch() {
    fixtureRequests++;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});
let extension: Awaited<ReturnType<typeof launchExtension>> | undefined;
try {
  extension = await launchExtension({ enabled: true, animate: true, mode: "remove", apiBase: observer.url }, {
    ignoreHTTPSErrors: true,
    args: ["--host-resolver-rules=MAP mail.google.com 127.0.0.1", "--no-proxy-server"],
  });
  const page = await extension.context.newPage();
  await page.mouse.move(0, 0);
  await page.goto(`https://mail.google.com:${site.port}/mail/u/0/#spam`);
  assert.equal(await page.title(), "Synthetic Gmail wave");
  assert(fixtureRequests > 0, "Never perform fixture assertions on a real mailbox");
  await until(async () => observations.some(record => record.finished !== undefined), "first real Jev result");

  const firstResponse = Math.min(...observations.flatMap(record => record.finished === undefined ? [] : [record.finished]));
  const wave = observations.filter(record => record.started < firstResponse);
  const candidates = wave.flatMap(record => record.batch.candidates);
  assert.equal(candidates.length, rowCount, "All 50 loaded rows, including offscreen rows, must be sent before any response");
  assert(candidates.every(candidate => candidate.ad.tag === "tr"), "Each candidate must be one complete mail row");
  assert.equal(new Set(candidates.map(candidate => candidate.id)).size, rowCount, "Do not duplicate rows");
  assert.deepEqual(wave.map(record => record.batch.candidates.length).sort((a, b) => a - b), [10, 20, 20]);
  assert(!JSON.stringify(wave.map(record => record.batch)).includes("DO_NOT_SEND_DRAFT"));

  await until(async () => wave.every(record => record.finished !== undefined), "all real Jev results");
  assert(wave.every(record => record.status === 200));
  const results = wave.flatMap(record => record.result?.results || []);
  assert.equal(results.filter(result => result.remove).length, 45, "Real Jev must reject all 45 explicit sales pitches");
  await until(async () => await page.locator("tr.zA").count() === 5, "all 45 approved row removals commit", 15000);
  assert.equal(await page.locator("#navigation, #composer").count(), 2, "Preserve mailbox navigation and drafts");
  assert.equal(observations.length, 3, "No four-row trickle or repeated inference for unchanged mail");
  console.log(`PASS: 50 loaded rows dispatched as 20 + 20 + 10 before the first real Jev response; 45 removed, 5 kept; dispatch spread ${Math.round(wave.at(-1)!.started - wave[0].started)}ms`);
} finally {
  await extension?.close();
  site.stop(true);
  observer.stop();
  await api.stop();
  await rm(directory, { recursive: true, force: true });
}

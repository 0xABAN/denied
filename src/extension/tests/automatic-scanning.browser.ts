/** Real Chromium and content script; only extension messaging/provider results are stubbed. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { DEFAULTS } from "../settings";

const build = await Bun.build({ entrypoints: ["src/extension/content.ts"], target: "browser", format: "iife" });
assert(build.success);
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.route("http://scan.test/**", route => route.fulfill({ contentType: "text/html",
    body: '<p id="first">Our library opens at nine each morning.</p>' }));
  await page.goto("http://scan.test/");
  await page.evaluate(defaults => {
    const state = window as any;
    state.checkedTexts = [];
    state.chrome = { runtime: { id: "test", onMessage: { addListener() {} },
      async sendMessage(message: any) {
        if (message.type === "settings") return { settings: defaults };
        if (message.type === "judge") {
          state.checkedTexts.push(...message.batch.candidates.map((candidate: any) => candidate.text));
          return { document_id: message.batch.document_id, policy_version: "test",
            results: message.batch.candidates.map((candidate: any) => ({ id: candidate.id,
              revision: candidate.revision, ad_score: 0, unsafe_score: 0, violent_entity_score: 0,
              remove: false, reasons: [] })) };
        }
        return {};
      } } };
  }, DEFAULTS);
  await page.addScriptTag({ content: await build.outputs[0].text() });
  const checked = (text: string) => page.waitForFunction(text =>
    (window as any).checkedTexts.some((value: string) => value.includes(text)), text, { timeout: 3000 });
  await checked("Our library opens");
  await page.evaluate(() => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "The astronomy club meets on Tuesday.";
    document.body.append(paragraph);
  });
  await checked("astronomy club");
  await page.locator("#first").evaluate(node => { node.textContent = "Updated library hours begin at ten."; });
  await checked("Updated library hours");
  const count = await page.evaluate(() => (window as any).checkedTexts.length);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => (window as any).checkedTexts.length), count,
    "Unchanged content should not be repeatedly submitted");
  console.log("PASS: initial, added and edited content scan automatically without Rescan; unchanged content is reused");
} finally {
  await browser.close();
}

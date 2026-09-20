/** Read-only public-layout survey. This reports access/coverage, not classification
 * accuracy or a successful live removal. Never solve challenges or use login data.
 */
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const urls: Record<string, string> = {
  youtube: "https://www.youtube.com/results?search_query=nature", amazon: "https://www.amazon.com/s?k=notebook",
  x: "https://x.com/explore", groupme: "https://web.groupme.com/", reddit: "https://www.reddit.com/r/science/",
  facebook: "https://www.facebook.com/", instagram: "https://www.instagram.com/", tiktok: "https://www.tiktok.com/explore",
  twitch: "https://www.twitch.tv/directory", pinterest: "https://www.pinterest.com/ideas/", linkedin: "https://www.linkedin.com/feed/",
  threads: "https://www.threads.com/", bluesky: "https://bsky.app/profile/bsky.app", ebay: "https://www.ebay.com/sch/i.html?_nkw=notebook",
  etsy: "https://www.etsy.com/search?q=notebook", walmart: "https://www.walmart.com/search?q=notebook", aliexpress: "https://www.aliexpress.com/",
  discord: "https://discord.com/channels/@me", whatsapp: "https://web.whatsapp.com/", telegram: "https://web.telegram.org/a/",
  slack: "https://app.slack.com/", google: "https://www.google.com/search?q=school+garden", bing: "https://www.bing.com/search?q=school+garden",
  duckduckgo: "https://duckduckgo.com/?q=school+garden", gmail: "https://mail.google.com/", outlook: "https://outlook.live.com/mail/",
};
const selected = process.argv.slice(2);
const entries = Object.entries(urls).filter(([id]) => !selected.length || selected.includes(id));
assert(entries.length && selected.every(id => id in urls), "Choose adapter IDs, or omit arguments to survey all 26");
const bundle = await Bun.build({ entrypoints: ["src/extension/adapters/index.ts"], target: "browser", format: "esm" });
assert(bundle.success);
const script = await bundle.outputs[0].text();
const browser = await chromium.launch({ channel: "chromium", headless: true });
const results: object[] = [];
async function survey() {
  // Bypass page CSP only for our own read-only instrumentation. The extension
  // normally runs in Chrome's isolated world; no site scripts are substituted.
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();
  for (;;) {
    const entry = entries.shift();
    if (!entry) break;
    const [site, url] = entry;
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(5000);
      const result = await page.evaluate(async ({ site, script }) => {
        const moduleURL = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
        const api = await import(moduleURL);
        URL.revokeObjectURL(moduleURL);
        const adapter = api.adapterFor();
        if (!adapter || adapter.id !== site) return { coverage: "unverified", reason: "Redirected or unsupported route", host: location.hostname, rules: [] };
        const rules = adapter.rules.map((rule: any) => {
          const matches = [...document.querySelectorAll(rule.selector)] as HTMLElement[];
          const sampled = matches.filter(el => el.getClientRects().length > 0).slice(0, 30);
          const accepted = sampled.filter(el => {
            const scope = api.ownership(el);
            return scope?.key === el && scope.nodes.length > 0;
          }).length;
          return { selector: rule.selector, matches: matches.length, sampled: sampled.length, accepted };
        });
        const accepted = rules.reduce((sum: number, rule: any) => sum + rule.accepted, 0);
        return { coverage: accepted ? "observed-boundaries" : "unverified", host: location.hostname,
          reason: accepted ? "Visible item scopes found; not a live-removal assertion" : "No supported visible items; login, challenge, loading or unmatched layout", rules };
      }, { site, script });
      results.push({ site, url, status: response?.status(), ...result });
      console.log(`${site}: ${result.coverage} (${result.rules.reduce((sum: number, rule: any) => sum + rule.accepted, 0)} accepted sampled items)`);
    } catch (error) {
      results.push({ site, url, coverage: "unverified", reason: error instanceof Error ? error.message.split("\n")[0] : String(error) });
      console.log(`${site}: unverified (navigation/instrumentation error)`);
    }
  }
  await context.close();
}
try { await Promise.all([survey(), survey(), survey()]); }
finally {
  await browser.close();
  await mkdir("artifacts", { recursive: true });
  await Bun.write("artifacts/adapters-live.json", JSON.stringify({ observed_at: new Date().toISOString(),
    scope: "Unauthenticated public entry points; at most 30 visible matches per rule; no provider calls or deletions", results }, null, 2));
}
console.log("Coverage report: artifacts/adapters-live.json. Unverified entries are not passing site-support checks.");

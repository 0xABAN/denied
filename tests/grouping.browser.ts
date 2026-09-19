/** Exercise the actual scanner in a browser; no model calls or substituted judgments. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const bundle = await Bun.build({ entrypoints: ["extension/src/scan.ts"], target: "browser", format: "esm" });
assert(bundle.success);
const script = await bundle.outputs[0].text();
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>
    .item { background: rgb(240,240,240); padding: 12px; margin: 12px; }
  </style><main>
    <div id="conversation">
      <div class="item" id="message-a"><div><b>Alice</b><time>10:00</time></div><p>Tickets for sale. DM me.</p></div>
      <div class="item" id="message-b"><div><b>Bob</b><time>10:01</time></div><p>Our meeting is tomorrow.</p></div>
    </div>
    <ul><li id="list-a"><strong>Notebook</strong><p>Buy for $5.</p></li><li id="list-b"><strong>Workshop</strong><p>Free entry.</p></li></ul>
    <section id="uncertain"><p id="separate-a">Unrelated paragraph.</p><p id="separate-b">Another paragraph.</p></section>
    <div class="item" id="thread-a"><p id="outer-text">Parent message.</p><ul><li id="reply-a">Reply one.</li><li id="reply-b">Reply two.</li></ul></div>
    <div class="item" id="thread-b"><p id="other-text">Other parent.</p><ul><li>Another reply.</li></ul></div>
    <div role="group" aria-label="Conversation" id="named-thread">
      <div role="group" aria-label="Casey: Tickets for sale" id="named-message"><div><div><button aria-label="Casey profile"><span>Avatar</span></button></div><div><div><b>Casey</b><time>11:00</time></div><p>Tickets for sale.</p></div></div></div>
      <div role="group" aria-label="Drew: Meeting tomorrow" id="named-neighbor"><div><b>Drew</b><p>Meeting tomorrow.</p></div></div>
    </div>
    <div role="group" aria-label="Discussion" id="unnamed-replies-thread">
      <div role="group"><p id="unnamed-sale">Desk for sale.</p></div>
      <div role="group"><p id="unnamed-warning">Do not send money to strangers.</p></div>
    </div>
  </main>`);
  const scan = async (root: string) => page.evaluate(async ({ script, root }) => {
    const module = await import(URL.createObjectURL(new Blob([script], { type: "text/javascript" })));
    return module.discover(document.querySelector(root)).map((el: HTMLElement) => ({
      id: el.id, text: module.evidence(el).text,
    }));
  }, { script, root });
  const initial = await scan("main");
  assert(initial.some((item: any) => item.id === "message-a" && item.text.includes("Alice") && item.text.includes("Tickets")), JSON.stringify(initial));
  assert(initial.some((item: any) => item.id === "message-b" && !item.text.includes("Tickets")));
  assert.equal(initial.filter((item: any) => item.id.startsWith("message-")).length, 2);
  assert(initial.some((item: any) => item.id === "list-a" && item.text.includes("Notebook") && item.text.includes("Buy")));
  assert(initial.some((item: any) => item.id === "separate-a"));
  assert(initial.some((item: any) => item.id === "separate-b"));
  assert(!initial.some((item: any) => ["conversation", "thread-a", "thread-b"].includes(item.id)));
  assert(initial.some((item: any) => item.id === "outer-text"));
  assert(initial.some((item: any) => item.id === "reply-a"));
  assert(initial.some((item: any) => item.id === "named-message" && item.text.includes("Casey") && item.text.includes("Avatar") && item.text.includes("Tickets")), "Named message must include its profile and body");
  assert(initial.some((item: any) => item.id === "named-neighbor"));
  assert(!initial.some((item: any) => item.id === "named-thread"), "Named conversation must not become a target");
  assert(!initial.some((item: any) => item.id === "unnamed-replies-thread"), "Unnamed nested groups must also prevent conversation removal");
  assert(initial.some((item: any) => item.id === "unnamed-sale"));
  assert(initial.some((item: any) => item.id === "unnamed-warning"));
  const partial = await scan("#message-a p");
  assert.equal(partial[0].id, "message-a", "A partial mutation scan must retain the same boundary");
  await page.evaluate(() => {
    const host = document.createElement("discussion-feed");
    host.id = "shadow-conversation";
    host.style.display = "block";
    host.attachShadow({ mode: "open" }).innerHTML = '<div role="log"><p id="shadow-sale">Tickets for sale.</p><p id="shadow-warning">Do not send money.</p></div>';
    document.querySelector("main")!.append(host);
  });
  const shadow = await scan("#shadow-conversation");
  assert(!shadow.some((item: any) => item.id === "shadow-conversation"), "A shadow conversation is not a single removable post");
  assert(shadow.some((item: any) => item.id === "shadow-sale"));
  assert(shadow.some((item: any) => item.id === "shadow-warning"));
  await page.evaluate(() => {
    const feed = document.createElement("custom-feed");
    feed.id = "nested-shadow-feed";
    feed.style.display = "block";
    const root = feed.attachShadow({ mode: "open" });
    for (const [id, text] of [["inner-sale", "Tickets for sale."], ["inner-safe", "Meeting tomorrow."]]) {
      const card = document.createElement("custom-card");
      card.id = id;
      card.style.display = "block";
      card.attachShadow({ mode: "open" }).innerHTML = `<p>${text}</p>`;
      root.append(card);
    }
    document.querySelector("main")!.append(feed);
  });
  const nestedShadow = await scan("#nested-shadow-feed");
  assert.deepEqual(nestedShadow.map((item: any) => item.id).sort(), ["inner-safe", "inner-sale"], "Nested components must select individual cards, not their feed host");
  console.log(JSON.stringify({ passed: true, candidates: initial.length, coherentMessages: 2,
    isolatedNeighbors: true, nestedRepliesPreserved: true, partialScanStable: true }));
} finally {
  await browser.close();
}

/** Delay one genuine response; never replace Jev's classifications. */
import assert from "node:assert/strict";
import { launchExtension } from "./browser";
import { LineDecoder } from "../ndjson";
import { localAPI, until } from "./api";

const api = await localAPI();
let release!: () => void;
const gate = new Promise<void>(done => { release = done; });
let held = false;
let adReturned = false;
let openStreams = 0;
const batchSizes: number[] = [];
const starts: { at: number; late: boolean }[] = [];
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  const body = request.method === "POST" ? await request.text() : undefined;
  const batches = path === "/judge-stream" ? JSON.parse(body!).batches : [];
  if (batches.length) openStreams++;
  for (const batch of batches) {
    starts.push({ at: performance.now(), late: JSON.stringify(batch).includes("Late arrival") });
    batchSizes.push(batch.candidates.length);
  }
  const response = await fetch(`${api.url}${path}`, {
    method: request.method, headers: { "Content-Type": "application/json" }, body,
  });
  if (path === "/judge-stream") {
    assert.equal(response.status, 200, "Real Jev request must succeed");
    return new Response(new ReadableStream({ async start(controller) {
      const reader = response.body!.getReader();
      const decoder = new LineDecoder();
      const encoder = new TextEncoder();
      const deliveries: Promise<void>[] = [];
      try {
        while (true) {
          const { value, done } = await reader.read();
          for (const line of decoder.decode(value, done)) {
            const message = JSON.parse(line);
            deliveries.push((async () => {
              if (JSON.stringify(batches[message.index]).includes("School garden")) {
                held = true;
                await gate;
              } else {
                adReturned = true;
              }
              controller.enqueue(encoder.encode(line + "\n"));
            })());
          }
          if (done) break;
        }
        await Promise.all(deliveries);
        controller.close();
      } catch (error) { controller.error(error); }
      finally { openStreams--; }
    } }), { headers: { "Content-Type": "application/x-ndjson" } });
  }
  const bytes = await response.arrayBuffer();
  return new Response(bytes, { status: response.status, headers: { "Content-Type": "application/json" } });
} });
const site = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
  return new Response(`<html><body>${Array.from({ length: 20 }, (_, i) => `<div class="ordinary" style="background: #eee; padding: 8px; margin: 8px"><div><b>Student ${i}</b><time>10:00</time></div><p>School garden ${i} has flowers.</p></div>`).join("")}<div role="group" aria-label="Seller: Colored pencils for sale" id="ad"><div><button aria-label="Seller profile"><span>Avatar</span></button><div><b>Seller</b><time>10:01</time><p>Buy our colored pencils today.</p></div></div></div></body></html>`, {
    headers: { "Content-Type": "text/html" },
  });
} });
const extension = await launchExtension({ enabled: true, animate: false, apiBase: `http://127.0.0.1:${proxy.port}` });
const { context, worker } = extension;
try {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${site.port}`);
  await until(() => held && adReturned, "both actual Jev responses", 30000);
  assert.deepEqual(batchSizes.sort((a, b) => a - b), [1, 20], "21 blocks must produce one full batch and one remainder");
  await until(async () => await page.locator("#ad").count() === 0, "ad removed while ordinary response remains held", 3000);
  assert.equal(await page.locator(".ordinary").count(), 20);
  const lateInsertedAt = performance.now();
  await page.evaluate(() => {
    const node = document.createElement("p");
    node.id = "late";
    node.textContent = "Late arrival: our school library has books about butterflies.";
    document.body.append(node);
  });
  await until(() => starts.some(start => start.late), "next wave starts while prior response remains held", 6500);
  const gap = starts.find(start => start.late)!.at - starts[0].at;
  assert.ok(starts.find(start => start.late)!.at - lateInsertedAt < 2000,
    "New content must not wait for the old five-second wave cooldown");
  assert.equal(starts.filter(start => !start.late).length, 2, "in-flight blocks must not be redispatched");
  const beforeRescan = starts.length;
  await worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    await chrome.tabs.sendMessage(tab!.id!, { type: "rescan" });
  }, page.url());
  await until(() => starts.length > beforeRescan, "explicit rescan starts immediately despite old wave timer", 1500);
  release();
  await until(() => openStreams === 0, "all genuine streams drain before browser shutdown", 30000);
  console.log(`PASS: independent results and overlapping waves; next wave at ${Math.round(gap)}ms; ordinary content retained`);
} finally {
  release();
  await extension.close();
  proxy.stop(true);
  site.stop(true);
  await api.stop();
}

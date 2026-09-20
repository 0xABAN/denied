import assert from "node:assert/strict";
import { launchExtension } from "./browser";

const extension = await launchExtension({});
const { context, popup, configure } = extension;
try {
  const read = () => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: "settings" })).settings);
  const restart = async () => {
    const session = await context.newCDPSession(popup);
    await session.send("ServiceWorker.enable");
    await session.send("ServiceWorker.stopAllWorkers");
    await session.detach();
    await popup.reload();
  };
  assert.equal((await read()).enabled, true);
  assert.equal((await read()).animate, true);
  const saved = await configure({ enabled: false, animate: false, apiBase: "http://localhost:9876" });
  await restart();
  assert.deepEqual(await read(), saved, "Explicit preferences survive worker restart");

  await popup.evaluate(() => chrome.storage.local.set({ automaticDefaultsApplied: false }));
  await restart();
  assert.deepEqual(await read(), { ...saved, enabled: true, animate: true }, "Upgrade preserves the API origin");
  await configure({ animate: false });
  await restart();
  assert.equal((await read()).animate, false, "The defaults migration runs only once");
  await assert.rejects(configure({ apiBase: "http://example.com" }), /HTTPS API origin/);
  console.log("PASS: real worker defaults, one-time migration, saved preferences and API validation");
} finally { await extension.close(); }

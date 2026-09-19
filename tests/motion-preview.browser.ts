/** Exercise the sample button against the actual local preview and renderer. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const preview = Bun.spawn(["bun", "tests/motion-preview.ts"], { stdout: "pipe", stderr: "inherit" });
const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const reader = preview.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const url = new TextDecoder().decode(value).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert(url, "Preview must report its listening URL");
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  const button = page.getByRole("button", { name: "Try the explosion", exact: true });
  const reset = page.getByRole("button", { name: "Reset button", exact: true });
  assert.equal(await button.count(), 1, "Preview needs a clickable sample button");

  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: "Dark appearance", exact: true }).click();
    await button.click();
    assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 1);
    assert.equal(await page.locator('[data-denied-ui="chains"], [data-denied-ui="stamp"]').count(), 0);
    await page.waitForFunction(() => !!document.querySelector('canvas[data-denied-ui="burst"]'));
    assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0,
      "The blinking white outline must be gone before the shard burst");
    await button.waitFor({ state: "detached" });
    await page.locator('canvas[data-denied-ui="burst"]').waitFor({ state: "detached" });
    assert.equal(await page.locator("#unwanted").count(), 1, "Button demo must leave the conversation alone");
    await reset.click();
    assert(await button.isVisible(), "Reset must restore the sample button");
    assert.equal(await page.locator('[data-denied-ui]').count(), 0);
    console.log(`PASS: sample button spins, shatters, is removed and resets in ${theme} mode`);
  }

  // Diagnostic comparison in an actual browser: the same transformed button
  // with and without an ancestor clip. Hit testing measures rendered visibility,
  // not just a bounding rectangle that can extend beyond an invisible region.
  await page.evaluate(() => {
    const stage = document.getElementById("button-stage")!;
    const target = document.getElementById("sample-button")!;
    const box = target.getBoundingClientRect();
    stage.style.cssText = `width:${box.width}px;height:${box.height}px;min-height:0;margin:60px auto;overflow:hidden`;
  });
  await button.click();
  const clipping = await button.evaluate(target => {
    const stage = target.parentElement!;
    for (const animation of target.getAnimations()) {
      animation.pause();
      animation.currentTime = 800;
    }
    const box = stage.getBoundingClientRect();
    const visibleOutside = () => {
      let hits = 0;
      for (let y = box.top - 60; y < box.bottom + 60; y += 2) {
        for (let x = box.left - 60; x < box.right + 60; x += 2) {
          if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) continue;
          if (document.elementFromPoint(x, y) === target) hits++;
        }
      }
      return hits;
    };
    const clipped = visibleOutside();
    stage.style.overflow = "visible";
    const unclipped = visibleOutside();
    return { clipped, unclipped };
  });
  assert(clipping.clipped > 0, "The wobble must remain visible outside an overflow-hidden parent");
  assert(clipping.unclipped > 0, "The same wobble must be visible when only the parent clip changes");
  await button.evaluate(target => {
    target.parentElement!.style.overflow = "hidden";
    for (const animation of target.getAnimations()) animation.play();
  });
  await button.waitFor({ state: "detached" });
  assert.equal(await page.locator("#button-stage").evaluate(stage => getComputedStyle(stage).overflow), "hidden",
    "Restore the parent overflow after removal");
  console.log("PASS: wobble escapes clipping and parent overflow is restored");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  preview.kill();
  await preview.exited;
}

/** Measure the real renderer in Chromium, including interpolated spin frames.
 * These are synthetic layout fixtures, not substituted classifier responses.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const build = await Bun.build({ entrypoints: ["src/extension/effects.ts"], target: "browser", format: "esm" });
assert(build.success);
const source = await build.outputs[0].text();
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));

async function setup(html: string) {
  await page.mouse.move(0, 0);
  await page.setContent(`<!doctype html><style>
    * {box-sizing:border-box} body {margin:60px;background:#fff;font:14px system-ui}
    .target {background:#eef2f6;border:1px solid #ddd} .label {white-space:nowrap;overflow:hidden}
    </style>${html}`);
  await page.evaluate(async source => {
    const { removeElement } = await import(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    (window as any).start = (element: HTMLElement) => {
      const originalText = element.textContent;
      return removeElement(element, { animate: true }, () => element.isConnected && element.textContent === originalText);
    };
  }, source);
}

try {
  // More visible removals than the old cap: every row gets a warning, but no
  // decoration is created for offscreen items that are removed immediately.
  await setup(`<table style="width:1382px;border-spacing:0;table-layout:fixed"><tbody>
    ${Array.from({ length: 18 }, (_, index) => `<tr class="target" style="display:flex;width:1382px;height:40px;align-items:center">
      <td style="width:220px;padding:8px">Example sender ${index + 1}</td>
      <td class="label">Synthetic email row — removal animation test</td></tr>`).join("")}
    </tbody></table><div class="target" style="position:absolute;top:2000px">Offscreen example</div>`);
  const wave = await page.evaluate(() => {
    const targets = [...document.querySelectorAll<HTMLElement>(".target")];
    (window as any).finished = Promise.all(targets.map(element => (window as any).start(element)));
    return { outlines: document.querySelectorAll('[data-denied-ui="outline"]').length,
      stillPresent: targets.filter(element => element.isConnected).length };
  });
  assert.equal(wave.outlines, 18, "Every visible animated row needs its own warning blink; never cap outlines");
  assert.equal(wave.stillPresent, 18, "Offscreen rows still remove immediately");
  await mkdir("artifacts", { recursive: true });
  for (const [name, time] of [["blink", 155], ["flip", 1080]] as const) {
    await page.evaluate(time => {
      for (const element of document.querySelectorAll('.target,[data-denied-ui="outline"]')) {
        for (const animation of element.getAnimations()) {
          animation.pause();
          animation.currentTime = time;
        }
      }
    }, time);
    if (name === "blink") {
      const rims = await page.locator('[data-denied-ui="outline"]').evaluateAll(elements => elements.map(element => ({
        opacity: getComputedStyle(element).opacity,
      })));
      assert.equal(rims.length, 18, "Every rim must survive until the warning blink");
      assert(rims.every(rim => Number(rim.opacity) > .5), "The warning outlines must actually be visible");
    }
    await page.screenshot({ path: `artifacts/motion-rows-${name}.png` });
  }
  await page.evaluate(() => document.getAnimations().forEach(animation => animation.play()));
  assert((await page.evaluate(() => (window as any).finished)).every(Boolean));
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0);
  console.log("PASS: 18 concurrent visible rows all blink and remove; no orphan outlines");

  for (const shape of [
    { name: "wide flex row", width: 1382, height: 40, display: "flex" },
    { name: "native table row", width: 1382, height: 40, display: "table-row" },
    { name: "tall strip", width: 40, height: 750, display: "block" },
    { name: "button", width: 220, height: 74, display: "block" },
    { name: "card", width: 480, height: 320, display: "block" },
    { name: "square", width: 160, height: 160, display: "block" },
    { name: "small square", width: 24, height: 24, display: "block" },
  ]) {
    const css = `width:${shape.width}px;height:${shape.height}px;display:${shape.display}`;
    await setup(shape.display === "table-row"
      ? `<table style="width:${shape.width}px;border-spacing:0;table-layout:fixed"><tbody><tr class="target" style="${css}"><td>Example</td></tr></tbody></table>`
      : `<div class="target" style="${css}"><span class="label">Example</span></div>`);
    const geometry = await page.locator(".target").evaluate(element => {
      const original = element.getBoundingClientRect();
      (window as any).finished = (window as any).start(element);
      const spin = element.getAnimations().find(animation => (animation.effect as KeyframeEffect)
        .getKeyframes().some(frame => /rotate[XY]\(/.test(String(frame.transform))))!;
      const { delay, duration } = spin.effect!.getTiming();
      const animations = [...element.getAnimations(), ...document.querySelector('[data-denied-ui="outline"]')!.getAnimations()];
      animations.forEach(animation => animation.pause());
      const samples = Array.from({ length: 121 }, (_, index) => {
        // Include times between keyframes: an attractive set of keyframes can
        // still produce a broken interpolated transform.
        animations.forEach(animation => { animation.currentTime = (delay || 0) + Number(duration) * index / 120; });
        const box = element.getBoundingClientRect();
        const rim = document.querySelector('[data-denied-ui="outline"]')!.getBoundingClientRect();
        return { width: box.width, height: box.height, x: box.x, y: box.y,
          rimError: Math.max(Math.abs(box.x - rim.x), Math.abs(box.y - rim.y),
            Math.abs(box.width - rim.width), Math.abs(box.height - rim.height)) };
      });
      return { original: { width: original.width, height: original.height }, samples };
    });
    const { width, height } = geometry.original;
    const shortSide = Math.min(width, height);
    const longSide = Math.max(width, height);
    const along = width > height ? "width" : "height";
    const across = width > height ? "height" : "width";
    const last = geometry.samples.at(-1)!;
    assert(Math.abs(last.width - width) < .1 && Math.abs(last.height - height) < .1,
      `${shape.name}: hold at the original size, not a pre-shrunken box (${last.width} × ${last.height})`);
    // Small Z tilts foreshorten the long edge by cos(tilt), but must not
    // reproduce the old 14% uniform shrink (193px on a Gmail-width row).
    assert(geometry.samples.every(sample => sample[along] >= longSide - shortSide * .03 - 1),
      `${shape.name}: the long dimension must stay nearly full-size during the flip`);
    assert(geometry.samples.every(sample => sample[along] <= longSide + shortSide * .6 + 1),
      `${shape.name}: perspective must not amplify a long edge beyond a short-side-sized budget`);
    assert(geometry.samples.every(sample => sample[across] <= shortSide * 1.4 + 1),
      `${shape.name}: tilt must not sweep across several neighboring items`);
    assert(geometry.samples.every(sample => sample.rimError < 1), `${shape.name}: outline and item must stay aligned`);
    await page.locator(".target").evaluate(element => { element.textContent = "Replacement cancels the sampled motion"; });
    assert.equal(await page.evaluate(() => (window as any).finished), false);
    assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0);
    console.log(`PASS: ${shape.name}, 121 rendered samples, bounded distortion, aligned outline, original-size handoff`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}

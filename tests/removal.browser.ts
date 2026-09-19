/** Actual animation and evidence code in Chromium; no model or judgment substitute. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const build = await Bun.build({ entrypoints: ["extension/src/effects.ts", "extension/src/scan.ts"],
  target: "browser", format: "esm", splitting: false });
assert(build.success);
const scripts = await Promise.all(build.outputs.map(async file => ({ name: file.path, text: await file.text() })));
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));

async function setup(count = 1) {
  await page.setContent(`<style>
    body { margin: 60px; font: 16px/1.4 system-ui; }
    article { width: 480px; padding: 18px; margin: 0 0 12px; background: #eee; border-radius: 18px; }
    p { margin: 6px 0; } #neighbor { padding: 20px; }
  </style>${Array.from({ length: count }, (_, i) => `<article id="target-${i}">
    <strong>Example message ${i}</strong><p>A message disappears with a lively, precise burst.</p>
  </article>`).join("")}<div id="neighbor">This ordinary message stays in place.</div>`);
  await page.evaluate(async scripts => {
    for (const script of scripts) {
      const module = await import(URL.createObjectURL(new Blob([script.text], { type: "text/javascript" })));
      if (script.name.endsWith("effects.js")) (window as any).effects = module;
      if (script.name.endsWith("scan.js")) (window as any).scan = module;
    }
    (window as any).results = [];
    (window as any).start = (id: string, animate = true) => {
      const element = document.getElementById(id)!;
      const fingerprint = JSON.stringify((window as any).scan.evidence(element));
      const started = performance.now();
      const current = () => element.isConnected &&
        JSON.stringify((window as any).scan.evidence(element)) === fingerprint;
      return (window as any).effects.removeElement(element, { animate }, current).then((removed: boolean) => {
        const result = { id, removed, ms: performance.now() - started };
        (window as any).results.push(result);
        return result;
      });
    };
  }, scripts);
}

try {
  await setup();
  const originalNeighbor = await page.locator("#neighbor").boundingBox();
  const effectStarted = performance.now();
  const blink = await page.evaluate(() => {
    const element = document.getElementById("target-0")!;
    element.style.outline = "1px solid rgb(17, 34, 51)";
    const originalStyle = element.getAttribute("style");
    void (window as any).start("target-0");
    const flash = element.getAnimations().find(animation =>
      (animation.effect as KeyframeEffect).getKeyframes().some(frame => "outlineColor" in frame || "outline" in frame));
    if (!flash) return null;

    // Sample the real browser animation clock rather than relying on sleeps to
    // land inside a 54ms flash. Resume it afterward for the full choreography.
    flash.pause();
    const colors = [20, 70, 110, 160, 200].map(time => {
      flash.currentTime = time;
      return getComputedStyle(element).outlineColor;
    });
    const timing = flash.effect!.getTiming();
    flash.currentTime = 0;
    flash.play();
    return { colors, timing, unchanged: originalStyle === element.getAttribute("style") };
  });
  assert(blink, "The targeted section must receive a quick white-outline double-blink");
  assert.equal(blink.timing.iterations, 2, "Blink exactly twice, never loop indefinitely");
  assert.equal(blink.timing.duration, 90, "Both blinks must finish in 180ms without delaying the spin");
  // Chromium normalizes fully transparent animated colors to transparent black.
  assert.deepEqual(blink.colors, ["rgb(255, 255, 255)", "rgba(0, 0, 0, 0)",
    "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)", "rgb(17, 34, 51)"]);
  assert(blink.unchanged, "The flash must not mutate the host's inline outline");
  await page.waitForTimeout(220);
  const winding = await page.locator("#target-0").evaluate(element => {
    const glint = document.querySelector<HTMLElement>('[data-denied-ui="glint"]');
    const surface = glint?.firstElementChild;
    const box = element.getBoundingClientRect();
    const lightBox = glint?.getBoundingClientRect();
    return {
      opacity: Number(getComputedStyle(element).opacity),
      frames: element.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes()),
      glint: glint && surface && lightBox ? {
        hidden: glint.getAttribute("aria-hidden"),
        pointerEvents: getComputedStyle(glint).pointerEvents,
        gradient: getComputedStyle(surface).backgroundImage,
        frames: glint.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes()),
        sweep: surface.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes()),
        alignment: Math.max(Math.abs(lightBox.x - box.x), Math.abs(lightBox.y - box.y),
          Math.abs(lightBox.width - box.width), Math.abs(lightBox.height - box.height)),
      } : null,
    };
  });
  const spinFrames = winding.frames.filter(frame => typeof frame.transform === "string" && frame.transform.includes("rotateY"));
  const angles = spinFrames.map(frame => Number(/rotateY\(([-\d.]+)deg\)/.exec(frame.transform as string)?.[1]));
  assert(angles.length >= 8, "The intact component must turn left-right around the vertical Y-axis");
  assert(spinFrames.every(frame => String(frame.transform).includes("perspective(")), "Perspective must make the near edge larger");
  assert(angles.at(-1)! <= -1440, "The side edge must rotate toward the viewer through four turns");
  const increments = angles.slice(1).map((angle, index) => angles[index] - angle);
  assert(increments.every((increment, index) => !index || increment >= increments[index - 1]),
    "Equal-time keyframes must accelerate instead of spinning at a constant speed");
  const wobble = spinFrames.map(frame => {
    const transform = String(frame.transform);
    return {
      x: Number(/translate3d\(([-\d.]+)px/.exec(transform)?.[1] ?? 0),
      tilt: Number(/rotateZ\(([-\d.]+)deg\)/.exec(transform)?.[1] ?? 0),
    };
  });
  assert(wobble.some(frame => frame.x > 10) && wobble.some(frame => frame.x < -10),
    "The spinning component must shake dramatically in both directions");
  assert(wobble.some(frame => frame.tilt > 6) && wobble.some(frame => frame.tilt < -6),
    "A strong alternating tilt should make the spin wobble");
  const earlyShake = Math.max(...wobble.slice(0, 8).map(frame => Math.abs(frame.x)));
  const lateShake = Math.max(...wobble.slice(-8).map(frame => Math.abs(frame.x)));
  assert(lateShake > earlyShake * 1.5 && lateShake <= 18, "Shake should build but remain bounded");
  for (const frame of [wobble[0], wobble.at(-1)!]) {
    assert.equal(frame.x, 0, "The shake must align with the original component at the burst handoff");
    assert.equal(frame.tilt, 0, "The tilt must align with the fragment atlas at the burst handoff");
  }
  assert(winding.opacity > .95, "Keep the component intact during the wind-up");
  assert(winding.glint, "A glass-like glint must accompany the spin");
  assert.equal(winding.glint.hidden, "true");
  assert.equal(winding.glint.pointerEvents, "none");
  assert(winding.glint.gradient.includes("linear-gradient"), "The reflection needs a narrow light band");
  assert(winding.glint.alignment < 1, `The glint must follow the spinning surface: ${winding.glint.alignment}px drift`);
  assert.deepEqual(winding.glint.frames.map(frame => frame.transform), spinFrames.map(frame => frame.transform));
  assert(String(winding.glint.sweep[0].transform).includes("-110%"));
  assert(String(winding.glint.sweep.at(-1)!.transform).includes("110%"), "The light must sweep through, not remain static");
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0, "Do not explode before peak speed");
  await page.waitForSelector("canvas[data-denied-ui]");
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0, "The glint must end at the explosion");
  await page.waitForTimeout(50);
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 1,
    "Peak speed should release one monochrome fragment layer");
  const ink = await page.locator("canvas[data-denied-ui]").evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let drawn = 0;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 20) {
      drawn++;
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 2) colored++;
    }
    return { drawn, colored };
  });
  assert(ink.drawn > 100, "The layer must contain real visible fragments, not an empty canvas");
  assert.equal(ink.colored, 0, "Removal ink must be monochrome");
  await page.waitForFunction(() => (window as any).results.length === 1);
  const result = await page.evaluate(() => (window as any).results[0]);
  assert(result.removed && result.ms >= 850 && result.ms < 1200, JSON.stringify(result));
  assert((await page.locator("#neighbor").boundingBox())!.y < originalNeighbor!.y);
  assert.equal(await page.locator("#neighbor").count(), 1);
  await page.waitForFunction(() => !document.querySelector("canvas[data-denied-ui]"));
  assert(performance.now() - effectStarted < 1450, "The explosion must finish promptly after the spin");
  console.log("PASS: fast white double-blink, accelerating Y-axis spin, glass glint, explosion and cleanup");

  await setup();
  await page.locator("#target-0").evaluate(element => {
    element.replaceChildren();
    element.setAttribute("style", "width:400px;height:180px;padding:0;border-radius:0;background:#222");
  });
  await page.evaluate(() => { void (window as any).start("target-0"); });
  await page.waitForSelector("canvas[data-denied-ui]");
  await page.waitForTimeout(250);
  const chunks = await page.locator("canvas[data-denied-ui]").evaluate((canvas: HTMLCanvasElement) => {
    // Measure connected painted regions in the real renderer, not a mocked
    // drawing context. Solid fixture surfaces make each separated shard visible.
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
    const seen = new Uint8Array(width * height);
    const sizes: { area: number; fill: number }[] = [];
    for (let start = 0; start < seen.length; start++) {
      if (seen[start] || pixels[start * 4 + 3] < 25) continue;
      const stack = [start];
      seen[start] = 1;
      let area = 0;
      let minX = width, maxX = 0, minY = height, maxY = 0;
      while (stack.length) {
        const pixel = stack.pop()!;
        area++;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        const neighbors = [pixel - width, pixel + width];
        if (x) neighbors.push(pixel - 1);
        if (x < width - 1) neighbors.push(pixel + 1);
        for (const neighbor of neighbors) {
          if (neighbor < 0 || neighbor >= seen.length || seen[neighbor] || pixels[neighbor * 4 + 3] < 25) continue;
          seen[neighbor] = 1;
          stack.push(neighbor);
        }
      }
      if (area > 20) sizes.push({ area, fill: area / ((maxX - minX + 1) * (maxY - minY + 1)) });
    }
    const ratio = width / parseFloat(canvas.style.width);
    return sizes.map(piece => ({ ...piece, area: piece.area / (ratio * ratio) }));
  });
  assert(chunks.length >= 4 && chunks.length <= 6, `Expected a handful of chunky pieces, got ${chunks.length}`);
  assert(chunks.filter(piece => piece.area > 1000).length >= 4, `Shards must stay substantial mid-flight: ${JSON.stringify(chunks)}`);
  // Pointed triangular silhouettes occupy at most half their bounding box;
  // allow a little rasterization tolerance and overlap between flying shards.
  assert(chunks.filter(piece => piece.fill < .55).length >= 4,
    `The rendered pieces must have pointed silhouettes, not rectangular tiles: ${JSON.stringify(chunks)}`);
  await page.waitForFunction(() => !document.querySelector("canvas[data-denied-ui]"));
  console.log("PASS: a handful of large shards stay chunky instead of shrinking into confetti");

  await setup();
  const canceled = await page.evaluate(async () => {
    const element = document.getElementById("target-0")!;
    element.style.cssText = "transform:rotate(1deg);opacity:.85;border:2px solid black;outline:1px solid rgb(17,34,51)";
    const before = element.getAttribute("style");
    const promise = (window as any).start("target-0");
    setTimeout(() => { element.querySelector("p")!.textContent = "Replacement content must survive."; }, 70);
    const result = await promise;
    return { ...result, before, after: element.getAttribute("style"), connected: element.isConnected,
      outline: getComputedStyle(element).outlineColor,
      animations: element.getAnimations().length, layers: document.querySelectorAll('canvas[data-denied-ui], [data-denied-ui="glint"]').length };
  });
  assert(!canceled.removed && canceled.connected);
  assert.equal(canceled.before, canceled.after);
  assert.equal(canceled.outline, "rgb(17, 34, 51)", "Canceling a blink must restore the original outline");
  assert.equal(canceled.animations, 0);
  assert.equal(canceled.layers, 0);
  console.log("PASS: changing content cancels the effect without corrupting host styles");

  await setup();
  await page.evaluate(() => { void (window as any).start("target-0"); });
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 1);
  await page.locator("#target-0 p").evaluate(element => { element.textContent = "New content must cancel the glass reflection too."; });
  await page.waitForFunction(() => (window as any).results.length === 1);
  assert(!(await page.evaluate(() => (window as any).results[0])).removed);
  assert.equal(await page.locator("#target-0").count(), 1);
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0);
  assert.equal(await page.locator("#target-0").evaluate(element => element.getAnimations().length), 0);
  console.log("PASS: changing evidence during the spin removes the active glint and preserves the component");

  await setup();
  await page.evaluate(() => { void (window as any).start("target-0"); });
  await page.waitForSelector("canvas[data-denied-ui]");
  await page.locator("#target-0 p").evaluate(element => { element.textContent = "A replacement arriving after the spin must survive too."; });
  await page.waitForFunction(() => (window as any).results.length === 1);
  assert.equal(await page.locator("#target-0").count(), 1);
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0);
  assert.equal(await page.locator("#target-0").evaluate(element => getComputedStyle(element).opacity), "1");
  console.log("PASS: changing evidence after the explosion restores the component and cancels its shards");

  await setup();
  await page.evaluate(() => {
    void (window as any).start("target-0");
    window.dispatchEvent(new Event("resize"));
  });
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0, "Resizing must immediately discard the glint");
  await page.waitForTimeout(760);
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0,
    "Resizing during the spin must discard stale fragment geometry before it is displayed");
  await page.waitForFunction(() => (window as any).results.length === 1);
  assert((await page.evaluate(() => (window as any).results[0])).removed);
  console.log("PASS: viewport changes discard prepared shards without blocking a valid removal");

  await setup();
  await page.evaluate(() => {
    document.body.style.minHeight = "2000px";
    void (window as any).start("target-0");
  });
  await page.waitForSelector("canvas[data-denied-ui]");
  const layerTop = await page.locator("canvas[data-denied-ui]").evaluate(element => element.getBoundingClientRect().top);
  await page.evaluate(() => window.scrollTo(0, 20));
  await page.waitForTimeout(40);
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 1,
    "Document scrolling caused by layout collapse must not erase an active explosion");
  const shiftedTop = await page.locator("canvas[data-denied-ui]").evaluate(element => element.getBoundingClientRect().top);
  assert.equal(Math.round(layerTop - shiftedTop), 20, "Active shards should remain anchored to document coordinates");
  await page.waitForFunction(() => !document.querySelector("canvas[data-denied-ui]"));
  console.log("PASS: active shards follow document scrolling instead of disappearing during layout collapse");

  await setup();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => (window as any).start("target-0"));
  assert(reduced.removed && reduced.ms < 80);
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0);
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setup();
  const disabled = await page.evaluate(() => (window as any).start("target-0", false));
  assert(disabled.removed && disabled.ms < 80);
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0);
  console.log("PASS: reduced motion and animation-off remove immediately without particles");

  await setup();
  await page.evaluate(() => {
    document.body.style.background = "#171717";
    const host = document.getElementById("target-0")!;
    host.style.cssText = "background:transparent;color:white";
    host.innerHTML = "";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<section style="background:transparent;color:white;padding:18px">A shadow message must remain visible during its removal.</section>';
    const target = root.querySelector("section")!;
    void (window as any).effects.removeElement(target, { animate: true }, () => target.isConnected);
  });
  await page.waitForSelector("canvas[data-denied-ui]");
  await page.waitForTimeout(50);
  const shadowInk = await page.locator("canvas[data-denied-ui]").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 20) { sum += data[i]; count++; }
    return count ? sum / count : 0;
  });
  assert(shadowInk > 180, "Dark surfaces outside a shadow root require light fragments");
  await page.waitForFunction(() => !document.querySelector("canvas[data-denied-ui]"));
  console.log("PASS: shadow messages inherit the surrounding dark surface");

  await setup(12);
  await page.evaluate(() => {
    // Overlap visible cards to stress simultaneous effects independently of viewport culling.
    document.querySelectorAll("article").forEach((el, i) => {
      el.style.cssText = `position:absolute;left:${60 + i * 8}px;top:${60 + i * 8}px`;
      void (window as any).start(el.id);
    });
  });
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 4, "Glint layers must be bounded across a wave");
  await page.waitForSelector("canvas[data-denied-ui]");
  assert(await page.locator("canvas[data-denied-ui]").count() <= 4, "Visual layers must be bounded across a wave");
  await page.waitForFunction(() => (window as any).results.length === 12);
  assert((await page.evaluate(() => (window as any).results)).every((r: any) => r.removed && r.ms < 1200));
  await page.waitForFunction(() => !document.querySelector("canvas[data-denied-ui]"));
  assert.deepEqual(errors, []);
  console.log("PASS: concurrent removals stay bounded, do not serialize, and leave no orphan effects");
} finally {
  await browser.close();
}

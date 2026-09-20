/** Actual animation and evidence code in Chromium; no model or judgment substitute. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const build = await Bun.build({ entrypoints: ["src/extension/effects.ts", "src/extension/scan.ts"],
  target: "browser", format: "esm", splitting: false });
assert(build.success);
const scripts = await Promise.all(build.outputs.map(async file => ({ name: file.path, text: await file.text() })));
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));

async function setup(count = 1) {
  await page.mouse.move(0, 0);
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
    (window as any).start = (target: string | HTMLElement, animate = true) => {
      const element = typeof target === "string" ? document.getElementById(target)! : target;
      const id = element.id;
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
  await page.locator("#target-0").evaluate(element => {
    element.addEventListener("pointerenter", () => element.classList.add("hovered"));
    // Some sites explicitly opt descendants back into pointer events.
    element.querySelector("p")!.style.pointerEvents = "auto";
  });
  await page.mouse.move(0, 0);
  await page.evaluate(() => { void (window as any).start("target-0"); });
  const hoverBlocked = await page.locator("#target-0").evaluate(element =>
    [element, element.querySelector("p")!].every(node => getComputedStyle(node).pointerEvents === "none"));
  assert(hoverBlocked, "Disappearing content and interactive descendants must not accept hover");
  await page.mouse.move(150, 90);
  await page.waitForFunction(() => (window as any).results.length === 1);
  assert((await page.evaluate(() => (window as any).results[0])).removed,
    "Pointer movement must not cancel the disappearance");
  console.log("PASS: disappearing content cannot receive hover, including opted-in descendants");

  await setup();
  await page.locator("#target-0").evaluate(element => {
    element.addEventListener("pointerenter", () => element.classList.add("hovered"));
    element.addEventListener("pointerleave", () => element.classList.remove("hovered"));
  });
  await page.mouse.move(150, 90);
  assert.equal(await page.locator("#target-0.hovered").count(), 1);
  await page.evaluate(() => { void (window as any).start("target-0"); });
  await page.mouse.move(151, 91);
  await page.waitForFunction(() => (window as any).results.length === 1);
  const hovered = await page.evaluate(() => (window as any).results[0]);
  assert(hovered.removed && hovered.ms < 150,
    "Already-hovered content must finish immediately, without triggering a pointerleave/animation loop");
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0);
  console.log("PASS: already-hovered content is removed without a hover/animation restart loop");

  for (const scrollRoot of ["document", "nested", "shadow"]) {
    await setup();
    await page.evaluate(scrollRoot => {
      const target = document.getElementById("target-0")!;
      const spacer = document.createElement("div");
      spacer.style.height = "2000px";
      let scroller: HTMLElement | Window = window;
      if (scrollRoot !== "document") {
        const container = document.createElement("section");
        container.style.cssText = "height:180px;overflow:auto";
        target.before(container);
        container.append(target, spacer);
        if (scrollRoot === "shadow") {
          const host = document.createElement("div");
          container.before(host);
          host.attachShadow({ mode: "open" }).append(container);
        }
        scroller = container;
      } else document.body.append(spacer);
      scroller.addEventListener("scroll", () => target.classList.add("scrolling"), { once: true });
      void (window as any).start(target);
      requestAnimationFrame(() => scroller.scrollTo(0, 40));
    }, scrollRoot);
    await page.waitForFunction(() => (window as any).results.length === 1);
    const result = await page.evaluate(() => (window as any).results[0]);
    assert(result.removed, `${scrollRoot} scrolling must commit rather than cancel removal`);
    await page.waitForFunction(() => !document.querySelector('[data-denied-ui="glint"],canvas[data-denied-ui]'));
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  console.log("PASS: document, nested and shadow scrolling finish valid removals before scroll-state mutations");

  await setup();
  const changedOnScroll = await page.evaluate(async () => {
    const target = document.getElementById("target-0")!;
    const removal = (window as any).start(target.id);
    target.querySelector("p")!.textContent = "Replacement content must survive scrolling.";
    window.dispatchEvent(new Event("scroll"));
    return removal;
  });
  assert(!changedOnScroll.removed, "Scroll must never bypass the changed-content guard");
  assert.equal(await page.locator("#target-0").count(), 1);

  await setup(2);
  const overflowCleanup = await page.evaluate(async () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    outer.style.overflow = "clip";
    inner.style.overflow = "hidden";
    const targets = [document.getElementById("target-0")!, document.getElementById("target-1")!];
    targets[0].before(outer);
    outer.append(inner);
    inner.append(...targets);
    const originalStyle = inner.getAttribute("style");
    const first = (window as any).start("target-0");
    const second = (window as any).start("target-1");
    const opened = [getComputedStyle(inner).overflow, getComputedStyle(outer).overflow];
    targets[0].querySelector("p")!.textContent = "Replacement one";
    await first;
    const shared = getComputedStyle(inner).overflow;
    const unchanged = inner.getAttribute("style") === originalStyle;
    // A page update during the effect must win over the original value.
    inner.style.overflow = "clip";
    targets[1].querySelector("p")!.textContent = "Replacement two";
    await second;
    return { opened, shared, unchanged, restored: getComputedStyle(inner).overflow,
      outer: getComputedStyle(outer).overflow,
      animations: inner.getAnimations().length + outer.getAnimations().length,
      connected: targets.every(target => target.isConnected) };
  });
  assert.deepEqual(overflowCleanup.opened, ["visible", "visible"]);
  assert.equal(overflowCleanup.shared, "visible", "A concurrent sibling still needs the unclipped parent");
  assert(overflowCleanup.unchanged && overflowCleanup.connected);
  assert.equal(overflowCleanup.restored, "clip", "Preserve host changes made during the animation");
  assert.equal(overflowCleanup.outer, "clip");
  assert.equal(overflowCleanup.animations, 0);
  console.log("PASS: nested clips, concurrent cancellation and host overflow changes are safely restored");

  await setup();
  const scrollSafety = await page.evaluate(async () => {
    const target = document.getElementById("target-0")!;
    const parent = document.createElement("div");
    parent.style.cssText = "height:100px;overflow:auto";
    target.before(parent);
    parent.append(target);
    parent.scrollTop = 10;
    const before = parent.scrollTop;
    const promise = (window as any).start(target.id);
    const during = { overflow: getComputedStyle(parent).overflow, top: parent.scrollTop };
    target.querySelector("p")!.textContent = "Cancel scroll fixture";
    await promise;
    return { before, during };
  });
  assert.equal(scrollSafety.during.overflow, "auto");
  assert.equal(scrollSafety.during.top, scrollSafety.before);
  console.log("PASS: actual scroll containers retain their overflow and scroll position");

  for (const dark of [false, true]) {
    await setup();
    await page.locator('#target-0').evaluate((element, dark) => {
      element.replaceChildren();
      // A zero-width glyph avoids the textless-media rectangle without adding
      // painted text, isolating the shard fill and fracture-edge colors.
      element.textContent = 'x';
      element.style.cssText = `font-size:0;width:400px;height:180px;padding:0;background:${dark ? '#222' : '#fff'}`;
      void (window as any).start(element.id);
    }, dark);
    const treatment = await page.evaluate(() => ({
      rim: getComputedStyle(document.querySelector('[data-denied-ui="outline"]')!).boxShadow,
      glint: getComputedStyle(document.querySelector('[data-denied-ui="glint"]')!.firstElementChild!).backgroundImage,
    }));
    assert.equal(treatment.rim.includes('35, 35, 35'), !dark, 'Only light surfaces need dark backing behind the white rim');
    assert.equal(treatment.glint.includes('45, 45, 45'), !dark, 'Only light surfaces need silver-gray glint shoulders');
    await page.waitForSelector('canvas[data-denied-ui="burst"]');
    const tones = await page.locator('canvas[data-denied-ui="burst"]').evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let pale = 0, charcoal = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 25) continue;
        if (pixels[i] > 220) pale++;
        if (pixels[i] > 40 && pixels[i] < 180) charcoal++;
      }
      return { pale, charcoal };
    });
    if (!dark) {
      assert(tones.pale > 1000 && tones.charcoal > 200, 'Light shards need pale interiors and visible charcoal fracture edges');
    } else {
      assert.equal(tones.pale, 0, 'Keep the original dark shard fill');
      // Unpremultiplying low-alpha edge pixels can shift a few gray values.
      assert(tones.charcoal < 10, 'Do not add new outlines to dark shards');
    }
    await page.waitForFunction(() => !document.querySelector('canvas[data-denied-ui="burst"]'));
    console.log(`PASS: ${dark ? 'dark treatment stays unchanged' : 'light shards, rim and glint gain contrast'}`);
  }

  await setup();
  await page.evaluate(() => { void (window as any).start("target-0"); });
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 1,
    "Add a separate white rim without rewriting the host outline");
  const blinking = await page.locator('[data-denied-ui="outline"]').evaluate(element => {
    const animation = element.getAnimations().find(animation => animation.effect?.getTiming().duration === 500)!;
    animation.pause();
    const samples = [0, 124, 125, 249, 250, 374, 375, 499, 500, 600].map(time => {
      animation.currentTime = time;
      return Number(getComputedStyle(element).opacity);
    });
    const style = getComputedStyle(element);
    return { samples, rim: style.boxShadow, backface: style.backfaceVisibility, pointerEvents: style.pointerEvents };
  });
  assert.deepEqual(blinking.samples, [1, 1, 0, 0, 1, 1, 0, 0, 0, 0]);
  assert(blinking.rim.includes("255, 255, 255") && blinking.rim.includes("3px"));
  assert.equal(blinking.backface, "visible", "The rim should remain visible when the button spins backward");
  assert.equal(blinking.pointerEvents, "none");
  await page.waitForFunction(() => (window as any).results.length === 1);
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0);
  console.log("PASS: independent white rim blinks twice within 500ms and cleans up");

  await setup();
  const originalNeighbor = await page.locator("#neighbor").boundingBox();
  const effectStarted = performance.now();
  const outlineInvariant = await page.evaluate(() => {
    const element = document.getElementById("target-0")!;
    element.style.outline = "1px solid rgb(17, 34, 51)";
    const originalStyle = element.getAttribute("style");
    void (window as any).start("target-0");
    const hasOutlineAnimation = element.getAnimations().some(animation =>
      (animation.effect as KeyframeEffect).getKeyframes().some(frame => "outlineColor" in frame || "outline" in frame));
    return { hasOutlineAnimation, unchanged: originalStyle === element.getAttribute("style") };
  });
  assert(!outlineInvariant.hasOutlineAnimation, "Removal motion must not add a white-outline animation");
  assert(outlineInvariant.unchanged, "Removal motion must not mutate the host's inline outline");
  await page.waitForTimeout(220);
  const winding = await page.locator("#target-0").evaluate(element => {
    const glint = document.querySelector<HTMLElement>('[data-denied-ui="glint"]');
    const surface = glint?.firstElementChild;
    const box = element.getBoundingClientRect();
    const lightBox = glint?.getBoundingClientRect();
    return {
      opacity: Number(getComputedStyle(element).opacity),
      spinDuration: element.getAnimations().find(animation => (animation.effect as KeyframeEffect)
        .getKeyframes().some(frame => String(frame.transform).includes("rotateY")))?.effect?.getTiming().duration,
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
  assert.equal(winding.spinDuration, 600, "Halve the spin without changing the blink duration");
  const angles = spinFrames.map(frame => Number(/rotateY\(([-\d.]+)deg\)/.exec(frame.transform as string)?.[1]));
  assert(angles.length >= 8, "The intact component must turn left-right around the vertical Y-axis");
  assert(spinFrames.every(frame => String(frame.transform).includes("perspective(")), "Perspective must make the near edge larger");
  assert.equal(angles.at(-1), -2520, "Complete seven turns within the existing spin duration");
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
  assert(wobble.some(frame => frame.x > 20) && wobble.some(frame => frame.x < -20),
    "The spinning component must shake dramatically in both directions");
  assert(wobble.some(frame => frame.tilt > 12) && wobble.some(frame => frame.tilt < -12),
    "A strong alternating tilt should make the spin wobble");
  const earlyShake = Math.max(...wobble.slice(0, 8).map(frame => Math.abs(frame.x)));
  const lateShake = Math.max(...wobble.slice(-8).map(frame => Math.abs(frame.x)));
  assert(lateShake > earlyShake * 1.5 && lateShake <= 28, "Shake should build but remain bounded");
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
  await page.waitForFunction(() => document.getElementById('target-0')?.getAnimations().some(animation =>
    animation.effect?.getTiming().duration === 600 && animation.playState === 'finished'));
  const held = await page.locator('#target-0').evaluate(element => getComputedStyle(element).transform);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('canvas[data-denied-ui="burst"]').count(), 0, 'Hold intact before breaking into shards');
  assert.equal(await page.locator('#target-0').evaluate(element => getComputedStyle(element).transform), held,
    'The pause should be still, not a slower spin');
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
  assert(result.removed && result.ms >= 1050 && result.ms < 1400, JSON.stringify(result));
  assert((await page.locator("#neighbor").boundingBox())!.y < originalNeighbor!.y);
  assert.equal(await page.locator("#neighbor").count(), 1);
  await page.waitForFunction(() => !document.querySelector("canvas[data-denied-ui]"));
  assert(performance.now() - effectStarted < 1650, "The explosion must finish promptly after the spin and pause");
  console.log("PASS: clean accelerating Y-axis spin, glass glint, explosion and cleanup");

  await setup();
  await page.locator("#target-0").evaluate(element => {
    element.replaceChildren();
    element.setAttribute("style", "width:400px;height:180px;padding:0;border-radius:0;background:#222");
  });
  await page.evaluate(() => { void (window as any).start("target-0"); });
  // Observe release on an animation frame: selector retry backoff can consume
  // most of the short burst before the mid-flight pixel sample starts.
  await page.waitForFunction(() => document.querySelector('canvas[data-denied-ui="burst"]'));
  await page.waitForTimeout(250);
  const chunks = await page.locator("canvas[data-denied-ui]").evaluate((canvas: HTMLCanvasElement) => {
    // Measure connected painted regions in the real renderer, not a mocked
    // drawing context. Solid fixture surfaces make each separated shard visible.
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
    const seen = new Uint8Array(width * height);
    const sizes: { area: number; fill: number; left: number; right: number }[] = [];
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
      if (area > 20) sizes.push({ area, fill: area / ((maxX - minX + 1) * (maxY - minY + 1)), left: minX, right: maxX });
    }
    const ratio = width / parseFloat(canvas.style.width);
    return sizes.map(piece => ({ ...piece, area: piece.area / (ratio * ratio), left: piece.left / ratio, right: piece.right / ratio }));
  });
  assert(chunks.length >= 4 && chunks.length <= 6, `Expected a handful of chunky pieces, got ${chunks.length}`);
  const spread = Math.max(...chunks.map(piece => piece.right)) - Math.min(...chunks.map(piece => piece.left));
  // The unchanged shard widths and rotation still contribute to the footprint;
  // Quartering the original travel does not quarter the total painted width.
  assert(spread < 470, `Keep the 400px fixture's burst compact; painted width was ${spread}px`);
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
    element.style.cssText = "transform:rotate(1deg);opacity:.85;border:2px solid black;outline:1px solid rgb(17,34,51);filter:brightness(.9)";
    const before = element.getAttribute("style");
    const promise = (window as any).start("target-0");
    const duringFilter = getComputedStyle(element).filter;
    setTimeout(() => { element.querySelector("p")!.textContent = "Replacement content must survive."; }, 70);
    const result = await promise;
    return { ...result, before, after: element.getAttribute("style"), connected: element.isConnected,
      duringFilter, afterFilter: getComputedStyle(element).filter,
      outline: getComputedStyle(element).outlineColor, pointerEvents: getComputedStyle(element).pointerEvents,
      animations: element.getAnimations().length, layers: document.querySelectorAll('canvas[data-denied-ui], [data-denied-ui="glint"]').length };
  });
  assert(!canceled.removed && canceled.connected);
  assert.equal(canceled.before, canceled.after);
  assert.match(canceled.duringFilter, /brightness\(0\.9\).*drop-shadow\(/,
    "The animated shadow must compose with the existing host filter");
  assert.equal(canceled.afterFilter, "brightness(0.9)", "Cancellation must restore the original filter");
  assert.equal(canceled.pointerEvents, "auto", "Canceled removals must restore interaction");
  assert.equal(canceled.outline, "rgb(17, 34, 51)", "Canceling removal motion must preserve the original outline");
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
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0, "Cancel the blinking rim with stale content");
  assert.equal(await page.locator("#target-0").evaluate(element => element.getAnimations().length), 0);
  console.log("PASS: changing evidence during the spin removes the active glint and preserves the component");

  await setup();
  await page.evaluate(() => { void (window as any).start("target-0"); });
  await page.waitForFunction(() => document.querySelector('canvas[data-denied-ui="burst"]'));
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
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 4, "Rims share the glint concurrency limit");
  await page.waitForSelector("canvas[data-denied-ui]");
  assert(await page.locator("canvas[data-denied-ui]").count() <= 4, "Visual layers must be bounded across a wave");
  await page.waitForFunction(() => (window as any).results.length === 12);
  assert((await page.evaluate(() => (window as any).results)).every((r: any) => r.removed && r.ms < 1400));
  await page.waitForFunction(() => !document.querySelector("canvas[data-denied-ui]"));
  assert.deepEqual(errors, []);
  console.log("PASS: concurrent removals stay bounded, do not serialize, and leave no orphan effects");
} finally {
  await browser.close();
}

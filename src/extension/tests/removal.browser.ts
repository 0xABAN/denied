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
    <strong>Example message ${i}</strong><p>A message disappears with a lively, precise implosion.</p>
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
  for (const shape of [
    { name: "wide strip", width: 900, height: 40, axis: "X" },
    { name: "tall strip", width: 40, height: 560, axis: "Y" },
    { name: "square", width: 160, height: 160, axis: "Y" },
    { name: "rotated wide strip", width: 480, height: 40, axis: "X", rotated: true },
    { name: "mail table row", width: 900, height: 40, axis: "X", table: true },
  ]) {
    await setup();
    const motion = await page.evaluate(shape => {
      let element = document.getElementById("target-0")!;
      if (shape.table) {
        const table = document.createElement("table");
        table.style.cssText = `width:${shape.width}px;border-spacing:0;table-layout:fixed`;
        const row = table.insertRow();
        row.insertCell().textContent = "Synthetic mail row";
        element.replaceWith(table);
        row.id = "target-0";
        element = row;
      }
      element.style.cssText = `box-sizing:border-box;width:${shape.width}px;height:${shape.height}px;padding:0;margin:0`;
      if (shape.rotated) element.style.transform = "rotate(90deg)";
      void (window as any).start(element.id);
      const spinFrames = (node: Element | null) => node?.getAnimations().flatMap(animation =>
        (animation.effect as KeyframeEffect).getKeyframes()).filter(frame => /rotate[XY]\(/.test(String(frame.transform))) || [];
      const frames = spinFrames(element);
      return { frames, rim: spinFrames(document.querySelector('[data-denied-ui="outline"]')),
        width: element.offsetWidth, height: element.offsetHeight };
    }, shape);
    assert.equal(motion.frames.length, 25, `${shape.name}: preserve the accelerating spin samples`);
    assert(motion.frames.every(frame => String(frame.transform).includes(`rotate${shape.axis}(`)),
      `${shape.name}: sweep the shorter local dimension into depth`);
    assert(motion.frames.every(frame => Math.abs(Number(/perspective\(([\d.]+)px\)/.exec(String(frame.transform))?.[1]) -
      Math.max(420, Math.max(motion.width, motion.height) * 2.2)) < .01),
      `${shape.name}: perspective accounts for the long edge's magnification`);
    if (!shape.rotated) assert.deepEqual(motion.rim, motion.frames, `${shape.name}: rim and component use identical motion`);
    await page.waitForFunction(() => (window as any).results.length === 1);
    assert((await page.evaluate(() => (window as any).results[0])).removed, `${shape.name}: removal must finish`);
  }
  console.log("PASS: short-dimension flips for wide, tall, square, transformed and table-row targets");

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
    await page.waitForFunction(() => !document.querySelector('[data-denied-ui="outline"],canvas[data-denied-ui]'));
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
      element.style.background = dark ? '#222' : '#fff';
      void (window as any).start(element.id);
    }, dark);
    await page.waitForSelector('[data-denied-ui="outline"]');
    const borderColor = await page.locator('[data-denied-ui="outline"]').evaluate(element => getComputedStyle(element).borderTopColor);
    assert.equal(borderColor, dark ? "rgb(255, 255, 255)" : "rgb(35, 35, 35)",
      "The opening rim must contrast with the underlying surface");
    assert.equal(await page.locator('canvas[data-denied-ui]').count(), 0,
      'The dark/light treatment must not create a decorative layer');
    const toneHandle = await page.waitForFunction(() => {
      const element = document.getElementById("target-0");
      const animation = element?.getAnimations().find(animation =>
        (animation.effect as KeyframeEffect | null)?.getKeyframes().some(frame => String(frame.transform).includes("scale(0)")));
      if (!element || !animation) return null;
      animation.pause();
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      return { duration: animation.effect?.getTiming().duration, filters: frames.map(frame => String(frame.filter)) };
    });
    const tone = await toneHandle.jsonValue() as { duration: number; filters: string[] } | null;
    assert(tone);
    assert.equal(tone.duration, 300);
    assert(tone.filters.every(filter => filter.includes("brightness(0)")));
    assert.equal(tone.filters.every(filter => filter.includes("invert(1)")), dark);
    await page.locator("#target-0").evaluate(element => element.getAnimations().forEach(animation => animation.play()));
    await page.waitForFunction(() => (window as any).results.length === 1);
    console.log(`PASS: ${dark ? 'dark' : 'light'} surfaces use the same centered implosion`);
  }

  await setup();
  await page.evaluate(() => { void (window as any).start("target-0"); });
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 1,
    "Add a separate white rim without rewriting the host outline");
  const blinking = await page.locator('[data-denied-ui="outline"]').evaluate(element => {
    const animation = element.getAnimations().find(animation =>
      (animation.effect as KeyframeEffect).getKeyframes().some(frame => "opacity" in frame))!;
    animation.pause();
    const opacityFrames = (animation.effect as KeyframeEffect).getKeyframes().map(frame => Number(frame.opacity));
    const target = document.getElementById("target-0");
    const spin = target?.getAnimations().find(candidate =>
      (candidate.effect as KeyframeEffect).getKeyframes().some(frame =>
        /rotate[XY]\(/.test(String(frame.transform))));
    const style = getComputedStyle(element);
    return { opacityFrames, easing: animation.effect?.getTiming().easing, border: style.border,
      borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle,
      boxSizing: style.boxSizing, backface: style.backfaceVisibility, pointerEvents: style.pointerEvents,
      blinkDuration: animation.effect?.getTiming().duration, spinDelay: spin?.effect?.getTiming().delay };
  });
  assert.deepEqual(blinking.opacityFrames, [0, 1, .08, .68, 0, 0],
    "The rim should use tapered opacity pulses instead of binary beeps");
  assert.equal(blinking.easing, "ease-in-out", "The rim should fade smoothly between pulse peaks");
  assert.equal(blinking.blinkDuration, 600, "The double blink should have a slightly slower 600ms rhythm");
  assert.equal(blinking.spinDelay, 720, "Start spinning only after the 600ms blink and 120ms pause");
  assert.equal(blinking.borderWidth, "6px", "The opening rim should be a visibly substantial 6px border");
  assert.equal(blinking.borderStyle, "solid", "The opening rim should not be a shadow-only stroke");
  assert.equal(blinking.boxSizing, "border-box", "The rim must stay inside the target box");
  assert(blinking.border.includes("35, 35, 35"), "Light surfaces need a dark rim for contrast");
  assert.equal(blinking.backface, "visible", "The rim should remain visible when the button spins backward");
  assert.equal(blinking.pointerEvents, "none");
  await page.waitForFunction(() => (window as any).results.length === 1);
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0);
  console.log("PASS: independent white rim blinks twice within 600ms, then spins");

  await setup();
  await page.locator("#target-0").evaluate(element => {
    element.style.borderRadius = "12px 24px 6px 30px / 8px 16px 4px 20px";
    void (window as any).start(element.id);
  });
  const roundedRim = await page.locator('[data-denied-ui="outline"]').evaluate(element => {
    const host = getComputedStyle(document.getElementById("target-0")!);
    const rim = getComputedStyle(element);
    const corners = ["borderTopLeftRadius", "borderTopRightRadius",
      "borderBottomRightRadius", "borderBottomLeftRadius"] as const;
    return { host: corners.map(corner => host[corner]), rim: corners.map(corner => rim[corner]),
      outline: rim.outlineStyle, shadow: rim.boxShadow };
  });
  assert.deepEqual(roundedRim.rim, roundedRim.host,
    "The blink rim must preserve each host corner, including elliptical radii");
  assert.equal(roundedRim.outline, "none", "The rim must not add a square outline around rounded corners");
  assert(roundedRim.shadow.includes("0px 0px 0px 1px"),
    "The light-surface contrast ring must follow the rim's rounded corners");
  await page.waitForFunction(() => (window as any).results.length === 1);
  console.log("PASS: blink rim follows rounded and elliptical host corners");

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
    return {
      opacity: Number(getComputedStyle(element).opacity),
      spinDuration: element.getAnimations().find(animation => (animation.effect as KeyframeEffect)
        .getKeyframes().some(frame => /rotate[XY]\(/.test(String(frame.transform))))?.effect?.getTiming().duration,
      spinDelay: element.getAnimations().find(animation => (animation.effect as KeyframeEffect)
        .getKeyframes().some(frame => /rotate[XY]\(/.test(String(frame.transform))))?.effect?.getTiming().delay,
      frames: element.getAnimations().flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes()),
    };
  });
  const spinFrames = winding.frames.filter(frame => typeof frame.transform === "string" && /rotate[XY]\(/.test(frame.transform));
  assert.equal(winding.spinDuration, 600, "Keep the spin duration at 600ms");
  assert.equal(winding.spinDelay, 720, "Keep the blink, pause, and spin ordering explicit");
  const angles = spinFrames.map(frame => Number(/rotateX\(([-\d.]+)deg\)/.exec(frame.transform as string)?.[1]));
  assert(angles.length >= 8 && angles.every(Number.isFinite), "The wide component must flip top-bottom around the X-axis");
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
  assert(wobble.some(frame => frame.x > 12) && wobble.some(frame => frame.x < -12),
    "The spinning component must wobble visibly in both directions");
  assert(wobble.some(frame => frame.tilt > 0) && wobble.some(frame => frame.tilt < 0),
    "A geometry-bounded alternating tilt should keep the spin lively");
  const earlyShake = Math.max(...wobble.slice(0, 8).map(frame => Math.abs(frame.x)));
  const lateShake = Math.max(...wobble.slice(-8).map(frame => Math.abs(frame.x)));
  assert(lateShake > earlyShake * 1.5 && lateShake <= 18, "Shake should build but remain restrained");
  for (const frame of [wobble[0], wobble.at(-1)!]) {
    assert.equal(frame.x, 0, "The shake must align with the original component at the spin handoff");
    assert.equal(frame.tilt, 0, "The tilt must align with the original component at the spin handoff");
  }
  assert(winding.opacity > .95, "Keep the component intact during the wind-up");
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0, "The old reflection layer must stay removed");
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 1, "Keep only the outline rim during the wind-up");
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0, "Do not create a layer before the implosion");

  await page.waitForFunction(() => document.getElementById('target-0')?.getAnimations().some(animation =>
    animation.effect?.getTiming().duration === 600 && animation.playState === 'finished'));
  const held = await page.locator('#target-0').evaluate(element => getComputedStyle(element).transform);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('canvas[data-denied-ui]').count(), 0, 'Hold intact before the implosion');
  assert.equal(await page.locator('#target-0').evaluate(element => getComputedStyle(element).transform), held,
    'The pause should be still, not a slower spin');

  const implosionHandle = await page.waitForFunction(() => {
    const element = document.getElementById("target-0");
    const animation = element?.getAnimations().find(animation =>
      (animation.effect as KeyframeEffect | null)?.getKeyframes().some(frame => String(frame.transform).includes("scale(0)")));
    if (!element || !animation) return null;
    animation.pause();
    return {
      duration: animation.effect?.getTiming().duration,
      transforms: (animation.effect as KeyframeEffect).getKeyframes().map(frame => String(frame.transform)),
      filters: (animation.effect as KeyframeEffect).getKeyframes().map(frame => String(frame.filter)),
      clipPaths: element.getAnimations().flatMap(animation =>
        (animation.effect as KeyframeEffect).getKeyframes().map(frame => String(frame.clipPath))),
    };
  });
  const implosion = await implosionHandle.jsonValue() as {
    duration: number; transforms: string[]; filters: string[]; clipPaths: string[];
  } | null;
  assert(implosion, "The final phase must animate the intact component");
  assert.equal(implosion.duration, 300, "The final phase should last exactly 200ms out and 100ms back");
  assert(implosion.transforms.some(transform => transform.includes("scale(1.5)")),
    "The intact component should expand through the first 200ms");
  assert(implosion.transforms.at(-1)?.includes("scale(0)"),
    "The final 100ms should retract to zero like a black hole");
  assert(implosion.filters.every(filter => filter.includes("brightness(0)")),
    "The final phase should turn the light-surface component black");
  assert(implosion.clipPaths.some(path => path.startsWith("polygon(") && path.includes("px")),
    "The retraction should become a very thin four-point star");
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0,
    "The implosion must not release a decorative canvas");
  await page.locator("#target-0").evaluate(element => element.getAnimations().forEach(animation => animation.play()));

  await page.waitForFunction(() => (window as any).results.length === 1);
  const result = await page.evaluate(() => (window as any).results[0]);
  assert(result.removed && result.ms >= 1050 && result.ms < 2350, JSON.stringify(result));
  assert((await page.locator("#neighbor").boundingBox())!.y < originalNeighbor!.y);
  assert.equal(await page.locator("#neighbor").count(), 1);
  assert(performance.now() - effectStarted < 2350, "The implosion must finish promptly after the blink, pause, spin and hold");
  console.log("PASS: clean accelerating short-dimension spin, centered expansion, implosion and cleanup");

  await setup();
  await page.locator("#target-0").evaluate(element => {
    element.style.cssText = "box-sizing:border-box;width:480px;height:80px;padding:0;margin:0;background:#eee;border-radius:0";
    void (window as any).start("target-0");
  });
  const rectangularStarHandle = await page.waitForFunction(() => {
    const element = document.getElementById("target-0");
    const animation = element?.getAnimations().find(animation =>
      (animation.effect as KeyframeEffect | null)?.getKeyframes().some(frame =>
        String(frame.clipPath).startsWith("polygon(")));
    if (!element || !animation) return null;
    animation.pause();
    return (animation.effect as KeyframeEffect).getKeyframes().map(frame => String(frame.clipPath));
  });
  const rectangularPaths = await rectangularStarHandle.jsonValue() as string[] | null;
  const rectangularStar = rectangularPaths?.find(path => path.startsWith("polygon("));
  assert.equal(rectangularStar?.replace(/\s+/g, ""),
    "polygon(240px0px,243px37px,480px40px,243px43px,240px80px,237px43px,0px40px,237px37px)",
    "The star must keep equal physical arm thickness around the center of a wide rectangle");
  await page.locator("#target-0").evaluate(element => element.getAnimations().forEach(animation => animation.play()));
  await page.waitForFunction(() => (window as any).results.length === 1);
  console.log("PASS: rectangular star geometry remains physically centered");

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
      animations: element.getAnimations().length, layers: document.querySelectorAll('canvas[data-denied-ui], [data-denied-ui="glint"], [data-denied-ui="outline"]').length };
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
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0);
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 1);
  await page.locator("#target-0 p").evaluate(element => { element.textContent = "New content must cancel the outline too."; });
  await page.waitForFunction(() => (window as any).results.length === 1);
  assert(!(await page.evaluate(() => (window as any).results[0])).removed);
  assert.equal(await page.locator("#target-0").count(), 1);
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0);
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0, "Cancel the blinking rim with stale content");
  assert.equal(await page.locator("#target-0").evaluate(element => element.getAnimations().length), 0);
  console.log("PASS: changing evidence during the spin removes the active outline and preserves the component");

  await setup();
  await page.evaluate(() => { void (window as any).start("target-0"); });
  await page.waitForFunction(() => document.getElementById("target-0")?.getAnimations().some(animation =>
    (animation.effect as KeyframeEffect | null)?.getKeyframes().some(frame => String(frame.transform).includes("scale(0)"))));
  await page.locator("#target-0").evaluate(element => element.getAnimations().forEach(animation => animation.pause()));
  await page.locator("#target-0 p").evaluate(element => { element.textContent = "A replacement arriving after the spin must survive too."; });
  await page.waitForFunction(() => (window as any).results.length === 1);
  assert.equal(await page.locator("#target-0").count(), 1);
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0);
  assert.equal(await page.locator("#target-0").evaluate(element => getComputedStyle(element).opacity), "1");
  console.log("PASS: changing evidence during the implosion restores the component and cancels its effects");

  await setup();
  await page.evaluate(() => {
    void (window as any).start("target-0");
    window.dispatchEvent(new Event("resize"));
  });
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0, "Resizing must not create the removed reflection layer");
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0, "Resizing must immediately discard the outline");
  await page.waitForTimeout(760);
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0,
    "Resizing during the spin must discard stale motion before it is displayed");
  await page.waitForFunction(() => (window as any).results.length === 1);
  assert((await page.evaluate(() => (window as any).results[0])).removed);
  console.log("PASS: viewport changes cancel stale motion without blocking a valid removal");

  await setup();
  await page.evaluate(() => {
    document.body.style.minHeight = "2000px";
    void (window as any).start("target-0");
  });
  await page.waitForFunction(() => document.getElementById("target-0")?.getAnimations().some(animation =>
    (animation.effect as KeyframeEffect | null)?.getKeyframes().some(frame => String(frame.transform).includes("scale(0)"))));
  await page.evaluate(() => window.scrollTo(0, 20));
  await page.waitForTimeout(40);
  assert.equal(await page.locator("#target-0").count(), 0,
    "Document scrolling must commit the active implosion rather than leave stale motion");
  console.log("PASS: active implosions finish cleanly when layout scrolls");

  await setup();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reduced = await page.evaluate(() => (window as any).start("target-0"));
  assert(reduced.removed && reduced.ms < 80);
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0);
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setup();
  const disabled = await page.evaluate(() => (window as any).start("target-0", false));
  assert(disabled.removed && disabled.ms < 80);
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0);
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 0);
  console.log("PASS: reduced motion and animation-off remove immediately without decorative motion");

  await setup();
  await page.evaluate(() => {
    document.body.style.background = "#171717";
    const host = document.getElementById("target-0")!;
    host.style.cssText = "background:transparent;color:white";
    host.innerHTML = "";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<section style="background:transparent;color:white;padding:18px">A shadow message must remain visible during its removal.</section>';
    const target = root.querySelector("section")!;
    void (window as any).effects.removeElement(target, { animate: true }, () => target.isConnected)
      .then((removed: boolean) => { (window as any).shadowRemoved = removed; });
  });
  await page.waitForFunction(() => (window as any).shadowRemoved === true);
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0,
    "Shadow-root removals must use the centered implosion without a canvas");
  console.log("PASS: shadow messages use the same canvas-free implosion");

  await setup(12);
  await page.evaluate(() => {
    // Overlap visible cards to stress simultaneous effects independently of viewport culling.
    document.querySelectorAll("article").forEach((el, i) => {
      el.style.cssText = `position:absolute;left:${60 + i * 8}px;top:${60 + i * 8}px`;
      void (window as any).start(el.id);
    });
  });
  assert.equal(await page.locator('[data-denied-ui="glint"]').count(), 0, "The old reflection layer must never return");
  assert.equal(await page.locator('[data-denied-ui="outline"]').count(), 12, "Every animated item must get its own outline");
  await page.waitForFunction(() => (window as any).results.length === 12);
  assert((await page.evaluate(() => (window as any).results)).every((r: any) => r.removed && r.ms < 2350));
  assert.equal(await page.locator("canvas[data-denied-ui]").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: concurrent removals all get outlines, do not serialize, and leave no orphan effects");
} finally {
  await browser.close();
}

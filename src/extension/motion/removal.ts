import { type Settings } from "../settings";
import { createOutline, OUTLINE_BLINK_MS } from "./outline";
import { releaseOverflowClips } from "./overflow";
import { scopeTree } from "../dom";
import { isDarkSurface, motionShadow } from "./surface";

const SPIN_MS = 600;
const PRE_SPIN_PAUSE_MS = 120;
const SPIN_DELAY_MS = OUTLINE_BLINK_MS + PRE_SPIN_PAUSE_MS;
const HOLD_MS = 300;
const EXPAND_MS = 200;
const RETRACT_MS = 100;
const IMPLODE_MS = EXPAND_MS + RETRACT_MS;
const EXPANSION_SCALE = 1.5;
const WOBBLE_X_PX = 18;
const WOBBLE_Y_PX = 5;
const WOBBLE_TILT_DEG = 12;
const STAR_ARM_PX = 3;
const SETTLE_MS = 250;
const EASE_OUT = "cubic-bezier(.22,1,.36,1)";

/** Keep the star's center and arm thickness stable across rectangular boxes. */
function centeredStarClip(element: HTMLElement, box: DOMRect): string {
  // clip-path percentages use the element's width and height independently.
  // That makes a percentage-only star look thicker on the shorter axis. The
  // untransformed offset box is the same border-box coordinate space used by
  // the polygon; the rect is only a fallback for elements without a layout box.
  const width = element.offsetWidth || box.width;
  const height = element.offsetHeight || box.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const arm = Math.max(.5, Math.min(STAR_ARM_PX, Math.min(width, height) / 8));
  const px = (value: number) => `${Number(value.toFixed(3))}px`;
  const point = (x: number, y: number) => `${px(x)} ${px(y)}`;
  return `polygon(${[
    point(centerX, 0),
    point(centerX + arm, centerY - arm),
    point(width, centerY),
    point(centerX + arm, centerY + arm),
    point(centerX, height),
    point(centerX - arm, centerY + arm),
    point(0, centerY),
    point(centerX - arm, centerY - arm),
  ].join(",")})`;
}

/** Resolve when the guarded DOM removal commits, not when decorative motion
 * finishes. Animation effects never rewrite host inline styles or clone live DOM.
 */
export function removeWithMotion(element: HTMLElement, settings: Settings, current: () => boolean): Promise<boolean> {
  if (!current()) return Promise.resolve(false);
  const box = element.getBoundingClientRect();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const outside = box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth;
  // Disabling hit testing on an already-hovered item fires pointerleave, which
  // can rewrite its evidence and restart removal. Commit before that happens.
  // Qualify :hover with :scope so this also works on quirks-mode pages.
  if (!settings.animate || document.hidden || reduced.matches || outside || element.matches(":scope:hover")) {
    element.remove();
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    const animations: Animation[] = [];
    let stopOutline: (() => void) | undefined;
    let restoreOverflow: (() => void) | undefined;
    let done = false;
    let fallback: ReturnType<typeof setTimeout>;
    const style = getComputedStyle(element);
    // Snapshot layout dimensions before any transform or collapse starts.
    const from: Keyframe = {};
    const to: Keyframe = {};
    for (const property of ["height", "minHeight", "paddingTop", "paddingBottom", "marginTop", "marginBottom", "borderTopWidth", "borderBottomWidth"] as const) {
      from[property] = style[property];
      to[property] = "0px";
    }
    const collapsible = !["inline", "contents", "table-cell", "table-row"].includes(style.display) &&
      !["absolute", "fixed"].includes(style.position);

    // Native scroll events do not cross shadow boundaries.
    const scrollRoots: EventTarget[] = [window];
    for (let root = element.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) {
      scrollRoots.push(root);
    }

    const finish = (remove: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      stopOutline?.();
      observer.disconnect();
      document.removeEventListener("visibilitychange", hidden);
      scrollRoots.forEach(root => root.removeEventListener("scroll", scrolled, true));
      reduced.removeEventListener("change", motionChanged);
      // Evaluate while the original evidence still exists. Only our own effects
      // are canceled; unrelated host animations and new styles are preserved.
      const commit = remove && element.isConnected && current();
      animations.forEach(animation => animation.cancel());
      restoreOverflow?.();
      if (commit) element.remove();
      resolve(commit);
    };
    const hidden = () => {
      if (document.hidden) finish(true);
    };
    const motionChanged = () => {
      if (reduced.matches) finish(true);
    };
    // Scroll changes geometry and often hover/classes too. Complete the guarded
    // deletion in capture, before page scroll handlers can restart the effect.
    const scrolled = (event: Event) => {
      finish(true);
    };
    const observer = new MutationObserver(() => { if (!current()) finish(false); });
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener("visibilitychange", hidden);
    scrollRoots.forEach(root => root.addEventListener("scroll", scrolled, { capture: true, passive: true }));
    reduced.addEventListener("change", motionChanged);
    fallback = setTimeout(() => finish(true), SPIN_DELAY_MS + SPIN_MS + HOLD_MS + IMPLODE_MS + SETTLE_MS + 650);

    void (async () => {
      try {
        // Leaving a flagged item interactive lets hover handlers rewrite its
        // evidence mid-removal. Disable hit testing, not freshness checks.
        // Descendants can explicitly override inherited pointer-events, including
        // inside shadow roots, so cover those too with owned, cancelable effects.
        for (const node of scopeTree([element])) {
          if (!(node instanceof Element) || getComputedStyle(node).pointerEvents === "none") continue;
          const frame = { pointerEvents: "none" };
          animations.push(node.animate([frame, frame], { duration: 1, fill: "both" }));
        }
        restoreOverflow = releaseOverflowClips(element);
        // Add to (rather than replace) host filters; cancellation restores them
        // automatically, including when the page changes during the animation.
        const shadow = { filter: motionShadow(element) };
        animations.push(element.animate([shadow, shadow], {
          duration: SPIN_MS + HOLD_MS + IMPLODE_MS, delay: SPIN_DELAY_MS, composite: "add", fill: "both",
        }));
        // Sweep the shorter dimension into depth: wide mail rows tumble about
        // X; tall cards turn about Y. Use the local border box so a host rotation
        // doesn't swap our choice (transforms operate in local coordinates).
        const width = element.offsetWidth || box.width;
        const height = element.offsetHeight || box.height;
        const shortSide = Math.min(width, height);
        const longSide = Math.max(width, height);
        const axis = width > height ? "X" : "Y";
        // Bound the *edge displacement*, not just the angle. A fixed 12-degree
        // tilt sweeps a long strip through several neighboring rows. At most
        // 10% of the short side may come from tilting either end of the long one.
        const tiltLimit = Math.min(WOBBLE_TILT_DEG, Math.asin(.2 * shortSide / longSide) * 180 / Math.PI);
        const swayX = Math.min(WOBBLE_X_PX, width * .05);
        const swayY = Math.min(WOBBLE_Y_PX, height * .05);
        // The short side sets depth, but the long side amplifies perspective.
        // Scale focal distance with the long side to keep that distortion local.
        const perspective = Math.max(420, longSide * 2.2);
        // Equal-time samples accelerate to a whole turn at the original size.
        // Shrinking belongs to the final implosion, not the flip's wind-up.
        const frames = Array.from({ length: 25 }, (_, index) => {
          const t = index / 24;
          const phase = Math.PI * 2 * (2 * t + 3 * t * t);
          const amplitude = index === 24 ? 0 : t ** .8;
          const x = (Math.sin(phase) * swayX * amplitude).toFixed(3);
          const y = (Math.sin(phase * 1.4) * swayY * amplitude).toFixed(3);
          const tilt = (Math.sin(phase + .7) * tiltLimit * amplitude).toFixed(3);
          return { offset: t,
              transform: `translate3d(${x}px,${y}px,0px) rotateZ(${tilt}deg) ` +
              `perspective(${perspective}px) rotate${axis}(${-2520 * t ** 2.6}deg)` };
        });
        stopOutline = createOutline(element, frames, SPIN_MS, SPIN_DELAY_MS);
        const spin = element.animate(frames,
          { duration: SPIN_MS, delay: SPIN_DELAY_MS, easing: "linear", composite: "add", fill: "forwards" });
        const origin = element.animate([{ transformOrigin: "50% 50%" }, { transformOrigin: "50% 50%" }],
          { duration: SPIN_MS, delay: SPIN_DELAY_MS, fill: "forwards" });
        animations.push(spin, origin);
        await spin.finished;
        if (done) return;
        if (!current()) return finish(false);
        stopOutline?.();
        // Keep the spin's final frame intact. An owned animation provides a
        // cancelable clock, so stale content cannot implode after the hold.
        const hold = element.animate([{}, {}], { duration: HOLD_MS });
        animations.push(hold);
        await hold.finished;
        if (done) return;
        if (!current()) return finish(false);

        // Add a short pressure pulse, then collapse the intact component to its
        // center. Additive composition preserves the final spin pose while the
        // separate scale curve supplies the black-hole-like implosion.
        restoreOverflow?.();
        const tone = isDarkSurface(element) ? "brightness(0) invert(1)" : "brightness(0)";
        const starClip = centeredStarClip(element, box);
        const implode = element.animate([
          { transform: "scale(1)", opacity: 1, filter: tone, offset: 0 },
          { transform: `scale(${EXPANSION_SCALE})`, opacity: 1, filter: tone, offset: EXPAND_MS / IMPLODE_MS },
          { transform: "scale(0)", opacity: 0, filter: tone, offset: 1 },
        ], { duration: IMPLODE_MS, easing: "cubic-bezier(.5,0,.1,1)", composite: "add", fill: "forwards" });
        animations.push(implode);
        // Narrow the visible silhouette into a four-point star at the exact
        // expansion-to-retraction handoff. Cancellation restores any host clip.
        const star = element.animate([
          { clipPath: style.clipPath, offset: 0 },
          { clipPath: starClip, offset: EXPAND_MS / IMPLODE_MS },
          { clipPath: starClip, offset: 1 },
        ], { duration: IMPLODE_MS, easing: "linear", fill: "forwards" });
        animations.push(star);
        await implode.finished;
        if (collapsible) {
          const settle = element.animate([from, to], { duration: SETTLE_MS, easing: EASE_OUT, fill: "forwards" });
          animations.push(settle);
          await settle.finished;
        }
        finish(true);
      } catch {
        if (done) return;
        // A rendering failure must not prevent an otherwise valid removal.
        finish(true);
      }
    })();
  });
}

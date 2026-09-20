import { type Settings } from "../settings";
import { prepareBurst, type Burst } from "./burst";
import { createGlint } from "./glint";
import { releaseOverflowClips } from "./overflow";
import { scopeTree } from "../dom";
import { motionShadow } from "./surface";

const SPIN_MS = 600;
const HOLD_MS = 300;
const PEAK_SCALE = .86;
const SETTLE_MS = 250;
const EASE_OUT = "cubic-bezier(.22,1,.36,1)";

/** Resolve when the guarded DOM removal commits, not when decorative particles
 * finish. Animation effects never rewrite host inline styles or clone live DOM.
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
    let burst: Burst | undefined;
    let burstStarted = false;
    let stopGlint: (() => void) | undefined;
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
      stopGlint?.();
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
      if (!commit || !burstStarted) burst?.cancel();
      resolve(commit);
    };
    const hidden = () => {
      if (document.hidden) { burst?.cancel(); finish(true); }
    };
    const motionChanged = () => {
      if (reduced.matches) { burst?.cancel(); finish(true); }
    };
    // Scroll changes geometry and often hover/classes too. Complete the guarded
    // deletion in capture, before page scroll handlers can restart the effect.
    const scrolled = (event: Event) => {
      if (event.target !== document && event.target !== window) burst?.cancel();
      finish(true);
    };
    const observer = new MutationObserver(() => { if (!current()) finish(false); });
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener("visibilitychange", hidden);
    scrollRoots.forEach(root => root.addEventListener("scroll", scrolled, { capture: true, passive: true }));
    reduced.addEventListener("change", motionChanged);
    fallback = setTimeout(() => { burst?.cancel(); finish(true); }, SPIN_MS + HOLD_MS + SETTLE_MS + 650);

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
        burst = prepareBurst(element, PEAK_SCALE);
        // Add to (rather than replace) host filters; cancellation restores them
        // automatically, including when the page changes during the animation.
        const shadow = { filter: motionShadow(element) };
        animations.push(element.animate([shadow, shadow], {
          duration: SPIN_MS + HOLD_MS, composite: "add", fill: "both",
        }));
        // Equal-time samples of an accelerating angle keep the last revolution
        // fastest. The white rim is a separate overlay, never a host-style edit.
        // Ending at a whole turn aligns the fragment atlas at handoff.
        const perspective = Math.max(420, box.width * 2.2);
        const frames = Array.from({ length: 25 }, (_, index) => {
          const t = index / 24;
          const phase = Math.PI * 2 * (2 * t + 3 * t * t);
          const amplitude = index === 24 ? 0 : t ** .8;
          const x = (Math.sin(phase) * 28 * amplitude).toFixed(3);
          const y = (Math.sin(phase * 1.4) * 8 * amplitude).toFixed(3);
          const tilt = (Math.sin(phase + .7) * 20 * amplitude).toFixed(3);
          return { offset: t,
            transform: `translate3d(${x}px,${y}px,0px) rotateZ(${tilt}deg) ` +
              `perspective(${perspective}px) rotateY(${-2520 * t ** 2.6}deg) scale(${1 - (1 - PEAK_SCALE) * t * t})` };
        });
        stopGlint = createGlint(element, frames, SPIN_MS);
        const spin = element.animate(frames,
          { duration: SPIN_MS, easing: "linear", composite: "add", fill: "forwards" });
        const origin = element.animate([{ transformOrigin: "50% 50%" }, { transformOrigin: "50% 50%" }],
          { duration: SPIN_MS, fill: "forwards" });
        animations.push(spin, origin);
        await spin.finished;
        if (done) return;
        if (!current()) return finish(false);
        stopGlint?.();
        // Keep the spin's final frame intact. An owned animation provides a
        // cancelable clock, so stale content cannot explode after the hold.
        const hold = element.animate([{}, {}], { duration: HOLD_MS });
        animations.push(hold);
        await hold.finished;
        if (done) return;
        if (!current()) return finish(false);

        // Hide the intact component on the same frame its shards appear.
        const hide = element.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: "forwards" });
        animations.push(hide);
        restoreOverflow?.();
        burst?.play();
        burstStarted = true;
        if (collapsible) {
          const settle = element.animate([from, to], { duration: SETTLE_MS, easing: EASE_OUT, fill: "forwards" });
          animations.push(settle);
          await settle.finished;
        }
        finish(true);
      } catch {
        if (done) return;
        // A rendering failure must not prevent an otherwise valid removal.
        burst?.cancel();
        finish(true);
      }
    })();
  });
}

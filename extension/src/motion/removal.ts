import { type Settings } from "../contracts";
import { prepareBurst, type Burst } from "./burst";
import { createGlint } from "./glint";

const SPIN_MS = 700;
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
  if (!settings.animate || document.hidden || reduced.matches || outside) {
    element.remove();
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    const animations: Animation[] = [];
    let burst: Burst | undefined;
    let stopGlint: (() => void) | undefined;
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

    const finish = (remove: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      stopGlint?.();
      observer.disconnect();
      document.removeEventListener("visibilitychange", hidden);
      reduced.removeEventListener("change", motionChanged);
      // Evaluate while the original evidence still exists. Only our own effects
      // are canceled; unrelated host animations and new styles are preserved.
      const commit = remove && element.isConnected && current();
      animations.forEach(animation => animation.cancel());
      if (commit) element.remove();
      else burst?.cancel();
      resolve(commit);
    };
    const hidden = () => {
      if (document.hidden) { burst?.cancel(); finish(true); }
    };
    const motionChanged = () => {
      if (reduced.matches) { burst?.cancel(); finish(true); }
    };
    const observer = new MutationObserver(() => { if (!current()) finish(false); });
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    document.addEventListener("visibilitychange", hidden);
    reduced.addEventListener("change", motionChanged);
    fallback = setTimeout(() => { burst?.cancel(); finish(true); }, 1600);

    void (async () => {
      try {
        burst = prepareBurst(element, PEAK_SCALE);
        // Equal-time samples of an accelerating angle keep the last revolution
        // fastest. The original card stays clean—no white outline is added.
        // Ending at a whole turn aligns the fragment atlas at handoff.
        const perspective = Math.max(420, box.width * 2.2);
        const frames = Array.from({ length: 25 }, (_, index) => {
          const t = index / 24;
          const phase = Math.PI * 2 * (2 * t + 3 * t * t);
          const amplitude = index === 24 ? 0 : t ** .8;
          const x = (Math.sin(phase) * 18 * amplitude).toFixed(3);
          const y = (Math.sin(phase * 1.4) * 8 * amplitude).toFixed(3);
          const tilt = (Math.sin(phase + .7) * 12 * amplitude).toFixed(3);
          return { offset: t,
            transform: `translate3d(${x}px,${y}px,0px) rotateZ(${tilt}deg) ` +
              `perspective(${perspective}px) rotateY(${-1440 * t ** 2.6}deg) scale(${1 - (1 - PEAK_SCALE) * t * t})` };
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
        // One phase boundary, not a separate timer: the intact component vanishes
        // on exactly the frame its shards start moving outward at peak speed.
        const hide = element.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: "forwards" });
        animations.push(hide);
        burst?.play();
        if (collapsible) {
          const settle = element.animate([from, to], { duration: SETTLE_MS, easing: EASE_OUT, fill: "forwards" });
          animations.push(settle);
          await settle.finished;
        }
        finish(true);
      } catch {
        // A rendering failure must not prevent an otherwise valid removal.
        burst?.cancel();
        finish(true);
      }
    })();
  });
}

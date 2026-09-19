import { OWN } from "../contracts";

const MAX_GLINTS = 4;
let active = 0;

/** Mirror the wind-up on an empty, clipped surface above the target. The light
 * never rewrites host backgrounds, inserts content into the target, or enters
 * its evidence. Call before starting the host animation, in the same JS task,
 * so both transforms share the browser's animation start frame.
 */
export function createGlint(element: HTMLElement, frames: Keyframe[], duration: number): (() => void) | undefined {
  if (active >= MAX_GLINTS) return;
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  // A viewport-aligned mirror cannot reconstruct an existing arbitrary host
  // transform. Omit this decoration in that case; the removal still proceeds.
  if (box.width < 2 || box.height < 2 || style.transform !== "none") return;

  const layer = document.createElement("div");
  layer.setAttribute(OWN, "glint");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = `all:initial;position:fixed;left:${box.left}px;top:${box.top}px;` +
    `width:${box.width}px;height:${box.height}px;overflow:hidden;pointer-events:none;` +
    `z-index:2147483645;transform-origin:50% 50%;backface-visibility:hidden;`;
  layer.style.borderRadius = style.borderRadius;

  const light = document.createElement("div");
  light.style.cssText = "all:initial;position:absolute;inset:0;pointer-events:none;" +
    "background:linear-gradient(112deg,transparent 32%,rgba(255,255,255,.12) 42%," +
    "rgba(255,255,255,.92) 48%,rgba(255,255,255,.5) 50%,rgba(255,255,255,.1) 57%,transparent 68%);";
  layer.append(light);

  const animations: Animation[] = [];
  const pageX = scrollX;
  const pageY = scrollY;
  let closed = false;
  let timeout: ReturnType<typeof setTimeout>;
  active++;

  const cancel = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    animations.forEach(animation => animation.cancel());
    window.removeEventListener("scroll", scrolled, true);
    window.removeEventListener("resize", cancel);
    document.removeEventListener("visibilitychange", cancel);
    layer.remove();
    active--;
  };
  const scrolled = (event: Event) => {
    if ((event.target === document || event.target === window) && scrollX === pageX && scrollY === pageY) return;
    cancel();
  };

  try {
    document.documentElement.append(layer);
    animations.push(layer.animate(frames, { duration, easing: "linear", composite: "add", fill: "forwards" }));
    animations.push(light.animate([
      { transform: "translateX(-110%)", opacity: 0 },
      { opacity: 1, offset: .12 },
      { opacity: 1, offset: .82 },
      { transform: "translateX(110%)", opacity: 0 },
    ], { duration, easing: "linear", fill: "forwards" }));
    window.addEventListener("scroll", scrolled, { capture: true, passive: true });
    window.addEventListener("resize", cancel, { passive: true });
    document.addEventListener("visibilitychange", cancel);
    timeout = setTimeout(cancel, duration + 200);
    return cancel;
  } catch {
    // Decorative failure is isolated from the guarded removal choreography.
    cancel();
  }
}

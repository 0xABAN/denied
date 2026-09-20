import { OWN } from "../contracts";
import { isDarkSurface } from "./surface";

export const OUTLINE_BLINK_MS = 600;
const OUTLINE_WIDTH_PX = 6;

/** Render only the cancelable outline rim used during the opening rhythm. */
export function createOutline(element: HTMLElement, frames: Keyframe[], duration: number, delay = 0): (() => void) | undefined {
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  if (box.width < 2 || box.height < 2 || style.transform !== "none") return;

  const rim = document.createElement("div");
  rim.setAttribute(OWN, "outline");
  rim.setAttribute("aria-hidden", "true");
  rim.style.cssText = `all:initial;position:fixed;left:${box.left}px;top:${box.top}px;` +
    `width:${box.width}px;height:${box.height}px;box-sizing:border-box;pointer-events:none;` +
    "z-index:2147483645;transform-origin:50% 50%;backface-visibility:visible;";
  for (const corner of ["borderTopLeftRadius", "borderTopRightRadius",
    "borderBottomRightRadius", "borderBottomLeftRadius"] as const) {
    rim.style[corner] = style[corner];
  }
  const darkSurface = isDarkSurface(element);
  rim.style.border = `${OUTLINE_WIDTH_PX}px solid ${darkSurface ? "white" : "rgb(35,35,35)"}`;
  // CSS outlines can square off rounded corners. A zero-spread shadow follows
  // the rim's border radius while keeping the light-surface contrast edge.
  rim.style.outline = "none";
  rim.style.boxShadow = darkSurface ? "none" : "0 0 0 1px rgba(35,35,35,.4)";
  rim.style.opacity = "0";

  const animations: Animation[] = [];
  const pageX = scrollX;
  const pageY = scrollY;
  let closed = false;
  let timeout: ReturnType<typeof setTimeout>;

  const cancel = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    animations.forEach(animation => animation.cancel());
    window.removeEventListener("scroll", scrolled, true);
    window.removeEventListener("resize", cancel);
    document.removeEventListener("visibilitychange", cancel);
    rim.remove();
  };
  const scrolled = (event: Event) => {
    if ((event.target === document || event.target === window) && scrollX === pageX && scrollY === pageY) return;
    cancel();
  };

  try {
    document.documentElement.append(rim);
    animations.push(rim.animate(frames, { duration, delay, easing: "linear", composite: "add", fill: "forwards" }));
    animations.push(rim.animate([
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: .16 },
      { opacity: .08, offset: .32 },
      { opacity: .68, offset: .48 },
      { opacity: 0, offset: .72 },
      { opacity: 0, offset: 1 },
    ], { duration: OUTLINE_BLINK_MS, easing: "ease-in-out", fill: "both" }));
    window.addEventListener("scroll", scrolled, { capture: true, passive: true });
    window.addEventListener("resize", cancel, { passive: true });
    document.addEventListener("visibilitychange", cancel);
    timeout = setTimeout(cancel, delay + duration + 200);
    return cancel;
  } catch {
    // Decorative failure is isolated from the guarded removal choreography.
    cancel();
  }
}

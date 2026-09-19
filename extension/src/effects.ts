import { OWN, type Decision, type Settings } from "./contracts";

const ROSE = "#e11d48";
const PULSE_MS = 450;
const POP_MS = 320;
const highlights = new Map<HTMLElement, () => void>();
let toast: HTMLElement | undefined;
let toastTimer: ReturnType<typeof setTimeout>;

export function clearHighlights(): void {
  for (const restore of highlights.values()) restore();
  highlights.clear();
}

export function highlight(el: HTMLElement, result: Decision): void {
  if (highlights.has(el)) return;
  const outline = el.style.outline;
  const tag = document.createElement("small");
  tag.setAttribute(OWN, "");
  tag.textContent = `denied. ${result.reasons.join(" + ")} · ${Math.round(Math.max(result.ad_score, result.unsafe_score) * 100)}%`;
  tag.style.cssText = `display:block;background:${ROSE};color:white;font:12px system-ui;padding:4px;pointer-events:none`;
  el.style.outline = `3px solid ${ROSE}`;
  el.append(tag);
  highlights.set(el, () => { el.style.outline = outline; tag.remove(); });
}

/** Resolve true only when this effect removed the still-current target. */
export function removeElement(el: HTMLElement, settings: Settings, current: () => boolean): Promise<boolean> {
  if (!current()) return Promise.resolve(false);
  if (!settings.animate || document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.remove();
    return Promise.resolve(true);
  }
  const previous = { outline: el.style.outline, outlineOffset: el.style.outlineOffset, transformOrigin: el.style.transformOrigin };
  return new Promise(resolve => {
    let finished = false;
    const animations: Animation[] = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(fallback);
      document.removeEventListener("visibilitychange", hidden);
      const remove = el.isConnected && current();
      animations.forEach(a => a.cancel());
      Object.assign(el.style, previous);
      if (remove) el.remove();
      resolve(remove);
    };
    const hidden = () => { if (document.hidden) finish(); };
    // Browser timers can be throttled; this is a fallback, not a real-time guarantee.
    const fallback = setTimeout(finish, 2500);
    document.addEventListener("visibilitychange", hidden);
    Object.assign(el.style, { outline: `3px solid ${ROSE}`, outlineOffset: "-3px", transformOrigin: "center" });
    void (async () => {
      try {
        const pulse = el.animate([
          { outlineColor: ROSE, boxShadow: "0 0 0 0 rgba(225,29,72,.75)" },
          { outlineColor: "#fb7185", boxShadow: "0 0 0 14px rgba(225,29,72,0)" },
        ], { duration: PULSE_MS, iterations: 2, easing: "ease-out" });
        animations.push(pulse);
        await pulse.finished;
        if (finished || !current()) return;
        const pop = el.animate([
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(1.08)", opacity: 1, offset: 0.3 },
          { transform: "scale(0)", opacity: 0 },
        ], { duration: POP_MS, easing: "cubic-bezier(.5,0,.9,.4)", fill: "forwards" });
        animations.push(pop);
        await pop.finished;
      } catch { /* The guarded finish path also handles a canceled animation. */ }
      finally { finish(); }
    })();
  });
}

export function notify(message: string): void {
  if (!toast?.isConnected) {
    toast = document.createElement("div");
    toast.setAttribute(OWN, "");
    toast.setAttribute("role", "status");
    toast.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#0f172a;color:#f8fafc;font:13px/1.4 system-ui;padding:10px 14px;border-radius:10px;max-width:320px;box-shadow:0 8px 24px #0005;pointer-events:none;opacity:0";
    toast.style.transition = matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "opacity .3s";
    document.documentElement.append(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (toast) toast.style.opacity = "0"; }, 2200);
}

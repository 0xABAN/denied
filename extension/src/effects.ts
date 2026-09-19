import { OWN, type Decision, type Settings } from "./contracts";
import { removeWithMotion } from "./motion/removal";

const ROSE = "#e11d48";
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

/** Stop native playback, including open shadow roots and slotted media. Opaque
 * iframe players stop when their containing iframe is removed, not via this API.
 */
function pauseMedia(root: Element | ShadowRoot): void {
  for (const node of [root, ...root.querySelectorAll("*")]) {
    if (node instanceof HTMLMediaElement) node.pause();
    if (node instanceof Element && node.shadowRoot) pauseMedia(node.shadowRoot);
    if (node instanceof HTMLSlotElement) node.assignedElements({ flatten: true }).forEach(pauseMedia);
  }
}

/** Resolve true only when this effect removed the still-current target. */
export function removeElement(el: HTMLElement, settings: Settings, current: () => boolean): Promise<boolean> {
  if (!current()) return Promise.resolve(false);
  pauseMedia(el);
  return removeWithMotion(el, settings, current);
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

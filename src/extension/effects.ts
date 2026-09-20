import { OWN, type Decision } from "./contracts";
import { type Settings } from "./settings";
import { removeWithMotion } from "./motion/removal";
import { ownership, type ItemScope } from "./adapters";
import { scopeTree } from "./dom";
import { removalGuard } from "./adapters/removal";

const ROSE = "#e11d48";
const highlights = new Map<HTMLElement, () => void>();
let toast: HTMLElement | undefined;
let toastTimer: ReturnType<typeof setTimeout>;

export function clearHighlights(): void {
  for (const restore of highlights.values()) restore();
  highlights.clear();
}

export function highlight(el: HTMLElement, result: Decision): void {
  const scope = ownership(el);
  for (const node of scope?.nodes || [el]) {
    if (node instanceof HTMLElement) highlightRegion(node, result);
  }
}

function highlightRegion(el: HTMLElement, result: Decision): void {
  if (highlights.has(el)) return;
  const outline = el.style.outline;
  const tag = document.createElement("small");
  tag.setAttribute(OWN, "");
  tag.textContent = `noped. ${result.reasons.join(" + ")} · ${Math.round(Math.max(result.ad_score, result.unsafe_score, result.violent_entity_score) * 100)}%`;
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

/** Resolve true only when the complete, still-current logical item was removed. */
export function removeElement(el: HTMLElement, settings: Settings, current: () => boolean,
                              applicable: () => boolean = current): Promise<boolean> {
  const scope = ownership(el);
  if (scope) return removeScope(scope, settings, current, applicable);
  if (!current()) return Promise.resolve(false);
  pauseMedia(el);
  return removeWithMotion(el, settings, current);
}

/** Delete only the approved regions, never their common ancestor. Disjoint
 * regions use a synchronous guarded commit so deleting one does not invalidate
 * sibling animations or briefly animate preserved replies/history.
 * ponytail: multi-region items skip animation; coordinated motion can be added separately.
 */
export async function removeScope(scope: ItemScope, settings: Settings, current: () => boolean,
                                  applicable: () => boolean = current): Promise<boolean> {
  if (!current()) return false;
  if (scope.nodes.length === 1 && scope.nodes[0] instanceof HTMLElement) {
    pauseMedia(scope.nodes[0]);
    return removeWithMotion(scope.nodes[0], settings, current);
  }

  const intact = removalGuard(scope);
  const removed = new Set<Node>();
  for (const node of scope.nodes) if (node instanceof Element) pauseMedia(node);
  for (const node of scope.nodes) {
    // A custom element's disconnectedCallback may synchronously change the next
    // region, create a reply, navigate, or disable filtering. Stop rather than
    // widening the old decision to newly introduced content.
    if (!applicable() || !intact(removed)) return false;
    const subtree = scopeTree([node]);
    node.remove();
    subtree.forEach(child => removed.add(child));
  }
  return true;
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

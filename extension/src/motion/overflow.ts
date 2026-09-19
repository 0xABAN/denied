import { renderedParent } from "../scan";

type Lease = { animation: Animation; users: number };
const active = new WeakMap<Element, Lease>();

/** Let motion escape non-scrolling overflow clips without rewriting host styles.
 * Shared ancestors stay open until their last animation releases them. Actual
 * scroll containers and viewport overflow are deliberately left untouched.
 */
export function releaseOverflowClips(target: HTMLElement): () => void {
  const leases: [Element, Lease][] = [];
  let closed = false;
  const restore = () => {
    if (closed) return;
    closed = true;
    for (const [element, lease] of leases) {
      if (--lease.users === 0) {
        lease.animation.cancel();
        active.delete(element);
      }
    }
  };

  try {
    for (let element = renderedParent(target); element; element = renderedParent(element)) {
      if (element === document.body || element === document.documentElement) break;
      let lease = active.get(element);
      if (!lease) {
        const style = getComputedStyle(element);
        const overflow = [style.overflowX, style.overflowY];
        if (!overflow.some(value => value === "hidden" || value === "clip")) continue;
        if (overflow.some(value => value === "auto" || value === "scroll") || element.scrollTop || element.scrollLeft) continue;
        const frame = { overflowX: "visible", overflowY: "visible" };
        lease = { animation: element.animate([frame, frame], { duration: 1, fill: "both" }), users: 0 };
        active.set(element, lease);
      }
      lease.users++;
      leases.push([element, lease]);
    }
    return restore;
  } catch (error) {
    restore();
    throw error;
  }
}

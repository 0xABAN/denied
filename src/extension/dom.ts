import { OWN } from "./contracts";

/** Use the rendered tree for slots/open shadow roots, not just parentElement. */
export function renderedParent(el: Element): Element | null {
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

export function containsRendered(parent: Node, child: Node): boolean {
  if (parent === child || parent.contains(child)) return true;
  for (let node = child instanceof Element ? child : child.parentElement; node; node = renderedParent(node)) {
    if (node === parent) return true;
  }
  return false;
}

/** Snapshot rendered children without the cost of iterating a live NodeList. */
export function renderedChildren(node: Node): Node[] {
  if (node instanceof HTMLSlotElement) {
    const assigned = node.assignedNodes({ flatten: true });
    if (assigned.length) return assigned;
  }
  const root = node instanceof Element && node.shadowRoot ? node.shadowRoot : node;
  const result: Node[] = [];
  for (let child = root.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

/** Enumerate rendered nodes once; useful for source changes and safe forest deletion. */
export function scopeTree(roots: readonly Node[]): Node[] {
  const seen = new Set<Node>();
  function visit(node: Node): void {
    if (seen.has(node) || (node instanceof Element && node.hasAttribute(OWN))) return;
    seen.add(node);
    renderedChildren(node).forEach(visit);
  }
  roots.forEach(visit);
  return [...seen];
}

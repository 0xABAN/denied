import { OWN } from "../contracts";
import { ownershipAttributes, renderedParent, scopeTree } from "./index";
import type { ItemScope } from "./types";

const ATTRIBUTES = [...new Set([...ownershipAttributes(), "class", "style", "hidden", "type", "slot", "title", "alt",
  "aria-label", "aria-description", "data-ad", "data-ad-slot", "data-sponsored", "data-actirise"])];
const PRIVATE = "script,style,noscript,template,input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox]";
const children = (node: Node) => [...node.childNodes].filter(child => !(child instanceof Element && child.hasAttribute(OWN)));

/** Guard a synchronous multi-root commit against custom-element callbacks.
 * Only our already-removed nodes may disappear. Snapshot structure/owned visible
 * text, never input values, drafts, or the contents of preserved conversations.
 */
export function removalGuard(scope: ItemScope): (removed: ReadonlySet<Node>) => boolean {
  const baseURI = document.baseURI;
  const owned = new Set(scopeTree(scope.nodes));
  const boundaries = new Set<Node>([scope.key, ...scope.regions, ...scope.preserved]);
  for (const root of [...scope.nodes, ...scope.preserved]) {
    for (let parent = root instanceof Element ? renderedParent(root) : root.parentElement;
      parent; parent = renderedParent(parent)) {
      boundaries.add(parent);
      if (parent === scope.key) break;
    }
  }
  const snapshots = [...new Set([...owned, ...boundaries])].map(node => ({
    node, parent: node.parentNode, children: children(node),
    attributes: node instanceof Element ? ATTRIBUTES.map(name => node.getAttribute(name)) : null,
    stream: node instanceof HTMLMediaElement ? node.srcObject : null,
    text: owned.has(node) && node instanceof Text && node.parentElement &&
      !node.parentElement.closest(PRIVATE) && node.parentElement.getClientRects().length ? node.data : null,
  }));

  return removed => {
    if (document.baseURI !== baseURI) return false;
    const remaining = [...owned].filter(node => !removed.has(node));
    const actualOwned = scopeTree(scope.nodes.filter(node => !removed.has(node)));
    if (remaining.length !== actualOwned.length || remaining.some((node, i) => node !== actualOwned[i])) return false;

    return snapshots.every(snapshot => {
      const { node } = snapshot;
      if (removed.has(node)) return true;
      if (!node.isConnected || node.parentNode !== snapshot.parent) return false;
      if (node instanceof HTMLMediaElement && node.srcObject !== snapshot.stream) return false;
      const expected = snapshot.children.filter(child => !removed.has(child));
      const actual = children(node);
      if (expected.length !== actual.length || expected.some((child, i) => child !== actual[i])) return false;
      if (snapshot.text !== null && node.textContent !== snapshot.text) return false;
      return !snapshot.attributes || (node instanceof Element &&
        ATTRIBUTES.every((name, i) => node.getAttribute(name) === snapshot.attributes![i]));
    });
  };
}

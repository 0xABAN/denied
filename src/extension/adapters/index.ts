import { OWN } from "../contracts";
import type { ItemRule, ItemScope, SiteAdapter } from "./types";
import { adapters } from "./catalog";

export type { ItemScope, SiteAdapter } from "./types";
export { adapters } from "./catalog";

// Preserve drafts and editable form state, not an item's playback/action
// controls. Input values remain excluded from evidence and removal snapshots.
const PRIVATE = `input:not([type=hidden],[type=button],[type=submit],[type=reset],[type=image],[type=range],[type=checkbox],[type=radio]),textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[${OWN}]`;
const CONTROLS = `nav,[role=navigation],${PRIVATE}`;
const COLLECTIONS = "html,body,main,[role=main],[role=feed],[role=log],[role=listbox]";
const IDENTITY_ATTRIBUTES = ["id", "href", "src", "srcset", "poster", "data", "data-asin", "data-listingid", "data-listing-id", "data-item-id",
  "data-message-id", "data-legacy-message-id", "data-id", "post-id", "comment-id", "video-id"];

export function adapterFor(url = new URL(location.href)): SiteAdapter | undefined {
  return adapters.find(adapter => adapter.hosts.some(host => host.startsWith(".")
    ? url.hostname === host.slice(1) || url.hostname.endsWith(host)
    : url.hostname === host) && (!adapter.routes || adapter.routes.test(url.pathname)) &&
    !adapter.excludedRoutes?.test(url.pathname));
}

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

export function protectedByAdapter(el: Element, adapter = adapterFor()): boolean {
  if (!adapter) return false;
  const selector = [CONTROLS, adapter.protected].filter(Boolean).join(",");
  for (let node: Element | null = el; node; node = renderedParent(node)) {
    if (node.matches(selector)) return true;
    const rule = adapter.rules.find(rule => rule.sharedIdentity && node!.matches(rule.selector));
    if (node instanceof HTMLElement && rule && sharedHeader(node, rule).some(header => containsRendered(header, el))) return true;
  }
  return false;
}

function outermost<T extends Element>(elements: T[]): T[] {
  return elements.filter(node => !elements.some(parent => parent !== node && containsRendered(parent, node)));
}

function matchesContent(node: Element, rule: ItemRule): boolean {
  return !rule.content || node.matches(rule.content) || Boolean(node.querySelector(rule.content));
}

/** A first row's name/avatar may belong to its headerless successor too. */
function sharedHeader(key: HTMLElement, rule: ItemRule): Element[] {
  if (!rule.sharedIdentity) return [];
  const { selector, row } = rule.sharedIdentity;
  const wrapper = row ? key.closest(row) : key;
  const sibling = wrapper?.nextElementSibling;
  const next = sibling?.matches(rule.selector) ? sibling : sibling?.querySelector(rule.selector);
  const hasVisibleHeader = next && [...next.querySelectorAll(selector)].some(node =>
    node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden");
  if (!next || !matchesContent(next, rule) || hasVisibleHeader) return [];
  return [...key.querySelectorAll(selector)];
}

function makeScope(key: HTMLElement, rule: ItemRule, adapter: SiteAdapter): ItemScope | null {
  if (!matchesContent(key, rule) || protectedByAdapter(key, adapter)) return null;
  const nestedItems = adapter.rules.map(item => item.selector).join(",");
  const boundarySelector = [CONTROLS, adapter.protected, rule.preserve, nestedItems,
    '[role=feed],[role=log],[role=listbox]'].filter(Boolean).join(",");
  // Parts selectors can match duplicate IDs inside recommendations/comments.
  // Inspect ancestry within the key, not just descendants of each part.
  const boundaries = rule.parts ? scopeTree([key]).filter((node): node is Element =>
    node instanceof Element && node !== key && node.matches(boundarySelector)) : [];
  const regions = outermost(rule.parts ? [...key.querySelectorAll<HTMLElement>(rule.parts)].filter(region =>
    !boundaries.some(boundary => containsRendered(boundary, region))) : [key]);
  if (!regions.length || regions.some(el => el.matches(`${COLLECTIONS},${CONTROLS}`))) return null;

  const protect = [CONTROLS, COLLECTIONS, adapter.protected, rule.preserve].filter(Boolean).join(",");
  const preserved = outermost([
    ...boundaries,
    ...scopeTree(regions).filter((node): node is Element => node instanceof Element && node !== key &&
      (node.matches(protect) || (!regions.includes(node as HTMLElement) && node.matches(nestedItems)))),
    // Unassigned light-DOM drafts still belong to the page even when a shadow
    // tree does not render them. Do not destroy their host around them.
    ...regions.flatMap(region => [...region.querySelectorAll(PRIVATE)]),
    ...sharedHeader(key, rule),
  ]);
  const nodes: (HTMLElement | Text)[] = [];
  const visited = new Set<Node>();
  function select(node: Node): void {
    if (visited.has(node) || preserved.some(part => containsRendered(part, node))) return;
    visited.add(node);
    if (preserved.some(part => containsRendered(node, part))) {
      renderedChildren(node).forEach(select);
    } else if (node instanceof HTMLElement || (node instanceof Text && node.data.trim())) {
      nodes.push(node);
    }
  }
  regions.forEach(select);
  return nodes.length ? { adapter: adapter.id, key, regions, preserved, nodes } : null;
}

/** Cache only for one discovery pass. Freshness checks must create a new resolver. */
export function ownershipResolver(url = new URL(location.href)): (el: Element) => ItemScope | null {
  const adapter = adapterFor(url);
  const cache = new WeakMap<HTMLElement, ItemScope | null>();
  return el => {
    if (!adapter || protectedByAdapter(el, adapter)) return null;
    for (let key: Element | null = el; key; key = renderedParent(key)) {
      if (!(key instanceof HTMLElement)) continue;
      const rule = adapter.rules.find(item => key!.matches(item.selector));
      if (!rule) continue;
      if (!cache.has(key)) cache.set(key, makeScope(key, rule, adapter));
      const scope = cache.get(key)!;
      if (scope && (el === key || scope.nodes.some(node => containsRendered(node, el) ||
          (node instanceof Text && node.parentElement === el)))) return scope;
      // A recognized but ambiguous/independent child never expands to an outer item.
      return null;
    }
    return null;
  };
}

export function ownership(el: Element, url = new URL(location.href)): ItemScope | null {
  return ownershipResolver(url)(el);
}

const identities = new WeakMap<Node, number>();
const fingerprints = new WeakMap<HTMLElement, { value: string; revision: number }>();
let nextIdentity = 0;
function nodeIdentity(node: Node | null): number {
  if (!node) return 0;
  let id = identities.get(node);
  if (!id) { id = ++nextIdentity; identities.set(node, id); }
  return id;
}

/** Local-only membership/identity fingerprint, including preserved replies and
 * parent changes. No selectors, raw site IDs or DOM references enter inference.
 */
export function ownershipFingerprint(scope: ItemScope): string {
  const value = JSON.stringify([scope.adapter, nodeIdentity(scope.key), document.baseURI,
    scope.nodes.map(nodeIdentity), scope.preserved.map(nodeIdentity),
    [...new Set([scope.key, ...scope.regions, ...scope.preserved, ...scopeTree(scope.nodes)])].map(node =>
      [nodeIdentity(node), nodeIdentity(node.parentNode),
        node instanceof Element ? IDENTITY_ATTRIBUTES.map(name => node.getAttribute(name)) : null])]);
  let previous = fingerprints.get(scope.key);
  if (!previous || previous.value !== value) {
    previous = { value, revision: ++nextIdentity };
    fingerprints.set(scope.key, previous);
  }
  return String(previous.revision);
}

/** Attributes which can change item ownership without changing visible text. */
export function ownershipAttributes(): string[] {
  const selectors = adapters.flatMap(adapter => [adapter.protected || "", ...adapter.rules.flatMap(rule =>
    [rule.selector, rule.content || "", rule.parts || "", rule.preserve || "", rule.sharedIdentity?.selector || "", rule.sharedIdentity?.row || ""])]).join(",");
  return [...new Set([...IDENTITY_ATTRIBUTES, "role", "aria-labelledby", "contenteditable",
    ...[...selectors.matchAll(/\[([\w-]+)/g)].map(match => match[1])])];
}

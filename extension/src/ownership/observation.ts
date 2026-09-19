/** Experimental, coverage-preserving observations. Not connected to the shipping scanner. */
import { OWN } from "../contracts";

export type ObservationNode = {
  id: string;
  parent: string | null;
  kind: "element" | "text" | "shadow";
  tag?: string;
  text?: string;
  role?: string;
  label?: string;
  alt?: string;
  slot?: string;
  assignedTo?: string;
  destination?: { host: string; scheme: string };
  bounds?: number[];
  blocked?: "private" | "hidden" | "non-content";
};

export type Observation = {
  root: Element;
  refs: Map<string, Node>;
  atoms: string[];
  complete: boolean;
  limits: { maxNodes: number; maxText: number };
  data: { root: string; nodes: ObservationNode[]; incomplete: string[] };
  signatures: Map<string, string>;
  url: string;
};

const identities = new WeakMap<Node, string>();
let sequence = 0;
const PRIVATE = `input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[${OWN}]`;
const NON_CONTENT = "script,style,noscript,template,head";

function barrier(element: Element): ObservationNode["blocked"] {
  if (element.matches(PRIVATE)) return "private";
  if (element.matches(NON_CONTENT)) return "non-content";
  const style = getComputedStyle(element);
  if (element.hasAttribute("hidden") || style.display === "none" ||
      style.visibility === "hidden" || style.contentVisibility === "hidden") return "hidden";
  return undefined;
}

/** A mutation-triggered subtree scan must not bypass an excluded ancestor. */
function inheritedBarrier(root: Element): ObservationNode["blocked"] {
  const pending: Node[] = [root];
  const seen = new Set<Node>();
  while (pending.length) {
    const node = pending.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    if (node instanceof Element) {
      const reason = barrier(node);
      if (reason) return reason;
      if (node.assignedSlot) pending.push(node.assignedSlot);
    }
    if (node.parentNode) pending.push(node.parentNode);
    if (node instanceof ShadowRoot) pending.push(node.host);
  }
  return undefined;
}

function identity(node: Node): string {
  let id = identities.get(node);
  if (!id) {
    id = `n${++sequence}`;
    identities.set(node, id);
  }
  return id;
}

/** Physical deletion ancestry, including shadow descendants; not inferred semantic ownership. */
export function contains(parent: Node, child: Node): boolean {
  for (let node: Node | null = child; node; node = node instanceof ShadowRoot ? node.host : node.parentNode) {
    if (node === parent) return true;
  }
  return false;
}

/**
 * Every eligible text node appears once. Ancestors are retained rather than deduplicated away.
 * Privacy/hidden exclusions remain explicit barriers. Limits make the observation incomplete.
 * IDs, classes, input values, and complete addresses are never part of the provider-facing data.
 */
export function observe(root: Element, options: Partial<Observation["limits"]> = {}): Observation {
  const limits = { maxNodes: 512, maxText: 24000, ...options };
  const refs = new Map<string, Node>();
  const signatures = new Map<string, string>();
  const nodes: ObservationNode[] = [];
  const incomplete = new Set<string>();
  let textSize = 0;
  const rootBarrier = inheritedBarrier(root);

  const visit = (node: Node, parent: string | null): void => {
    if (refs.has(identity(node))) return;
    if (node instanceof Text && !node.data.trim()) return;
    if (!(node instanceof Element || node instanceof Text || node instanceof ShadowRoot)) return;
    if (nodes.length >= limits.maxNodes) {
      incomplete.add("node-limit");
      return;
    }
    const id = identity(node);
    const record: ObservationNode = { id, parent, kind: node instanceof Text ? "text" : node instanceof ShadowRoot ? "shadow" : "element" };
    let localAddress = "";
    let localStyle = "";
    if (node instanceof Text) {
      record.text = node.data.trim();
      textSize += record.text.length;
    } else if (node instanceof Element) {
      record.tag = node.tagName.toLowerCase();
      const style = getComputedStyle(node);
      localStyle = [style.display, style.visibility, style.contentVisibility].join("|");
      record.blocked = node === root ? rootBarrier : barrier(node);
      if (!record.blocked) {
        for (const [key, attribute] of [["role", "role"], ["label", "aria-label"], ["alt", "alt"], ["slot", "slot"]] as const) {
          const value = node.getAttribute(attribute);
          if (value) {
            record[key] = value;
            textSize += value.length;
          }
        }
        if (node instanceof HTMLSlotElement && node.name) record.slot = node.name;
        if (node.assignedSlot) record.assignedTo = identity(node.assignedSlot);
        localAddress = node.getAttribute("href") || node.getAttribute("src") || "";
        if (localAddress) {
          try {
            const address = new URL(localAddress, root.ownerDocument.baseURI);
            record.destination = { host: address.hostname, scheme: address.protocol.slice(0, -1) };
          } catch {
            record.destination = { host: "", scheme: "" };
          }
        }
        const rect = node.getBoundingClientRect();
        record.bounds = [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value));
      }
    }
    if (textSize > limits.maxText) {
      incomplete.add("text-limit");
      return;
    }
    nodes.push(record);
    refs.set(id, node);
    // Geometry is intentionally absent from freshness: scrolling and our own preceding
    // deletions can move unchanged nodes. Membership, identity, content, and links must match.
    const { bounds: _bounds, ...facts } = record;
    signatures.set(id, JSON.stringify([facts, localAddress, localStyle]));
    if (record.blocked) return;
    for (const child of node.childNodes) visit(child, id);
    if (node instanceof Element && node.shadowRoot) visit(node.shadowRoot, id);
  };

  visit(root, null);
  const parents = new Set(nodes.map(node => node.parent));
  const atoms = nodes.filter(node => !node.blocked && node.kind !== "shadow" &&
    (node.kind === "text" || !parents.has(node.id) || node.label || node.alt || node.destination)).map(node => node.id);
  return { root, refs, atoms, complete: incomplete.size === 0, limits, signatures,
    data: { root: identity(root), nodes, incomplete: [...incomplete] }, url: root.ownerDocument.URL };
}

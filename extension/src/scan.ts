import { OWN, type Candidate } from "./contracts";
import { COLLECTION, itemBoundaries } from "./grouping";
import { adapterFor, containsRendered, ownership, ownershipFingerprint, ownershipResolver,
  protectedByAdapter, renderedChildren, renderedParent, type ItemScope, type SiteAdapter } from "./adapters";
export { renderedParent } from "./adapters";

const EXCLUDED = `script,style,noscript,template,head,svg,input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[hidden],[${OWN}]`;
const PAGE = "html,body,main,nav,header,footer,form,ul,ol,table";
const INLINE = /^(SPAN|A|STRONG|EM|B|I|SMALL|MARK|LABEL)$/;
const MEDIA = "iframe,img,video,audio,canvas,object,embed";
const LABEL = /^(ad|advertisement|sponsored(?: content)?|paid partnership|promoted|anzeige|werbung)$/i;
const HOSTS = ["doubleclick.net", "googlesyndication.com", "googleadservices.com", "taboola.com", "outbrain.com", "amazon-adsystem.com"];
const MAX_TEXT = 24000;
export type Evidence = Omit<Candidate, "id" | "revision"> & {
  complete: boolean; text_truncated: boolean;
  /** Browser-only identity tokens; source URLs and stream objects never enter the API payload. */
  media_revisions: number[];
  /** Browser-local membership and site identity, excluded from Candidate payloads. */
  ownership_revision: string;
};
const mediaIdentities = new WeakMap<Element, { sources: string; stream: unknown; revision: number }>();
let mediaRevision = 0;

/** Source paths can change without changing hostnames or titles. Keep that
 * distinction local so a late judgment cannot remove a replacement video.
 */
function mediaIdentity(node: Element): number {
  const sources = JSON.stringify(["src", "srcset", "poster", "data", "href", "type"].map(name => node.getAttribute(name)));
  const stream = node instanceof HTMLMediaElement ? node.srcObject : null;
  let previous = mediaIdentities.get(node);
  if (!previous || previous.sources !== sources || previous.stream !== stream) {
    previous = { sources, stream, revision: ++mediaRevision };
    mediaIdentities.set(node, previous);
  }
  return previous.revision;
}

export function visible(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected || el.closest(EXCLUDED)) return false;
  const style = getComputedStyle(el);
  return el.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
}

/** A logical item's key can be display:contents or enclose disjoint regions. */
export function visibleItem(el: HTMLElement): boolean {
  const scope = ownership(el);
  return scope ? scope.nodes.some(node => visible(node instanceof Element ? node : node.parentElement!)) : visible(el);
}

/** Physical containment alone must not swallow independent replies or reviews. */
export function owns(parent: HTMLElement, child: HTMLElement): boolean {
  if (!containsRendered(parent, child)) return false;
  const scope = ownership(parent);
  return scope ? scope.nodes.some(node => containsRendered(node, child)) : containsRendered(parent, child);
}

function textNodes(root: Node, onShadow?: (root: ShadowRoot) => void,
                   onElement?: (element: Element) => void,
                   isVisible: typeof visible = visible): Text[] {
  const nodes: Text[] = [];
  const visited = new Set<Node>();
  const visit = (node: Node): void => {
    if (visited.has(node)) return;
    visited.add(node);
    if (node instanceof Text) {
      if (node.data.trim() && node.parentElement && isVisible(node.parentElement)) nodes.push(node);
      return;
    }
    if (node instanceof Element && node.matches(EXCLUDED)) return;
    if (node instanceof Element) onElement?.(node);
    if (node instanceof Element && node.shadowRoot) onShadow?.(node.shadowRoot);
    // Slots supply light-DOM content exactly once; unassigned children stay out.
    renderedChildren(node).forEach(visit);
  };
  visit(root);
  return nodes;
}

function text(root: Element, isVisible: typeof visible): string {
  return textNodes(root, undefined, undefined, isVisible).map(n => n.data.trim()).join(" ").replace(/\s+/g, " ").trim();
}

/** Keep address context, not paths, credentials, query tokens, or fragments. Empty scheme means unknown. */
function address(value: string | null): { host: string; scheme: string } {
  try {
    const url = value === null ? null : new URL(value, document.baseURI);
    const scheme = url?.protocol.slice(0, -1) || "";
    return { host: url?.hostname || "", scheme: scheme.length <= 32 ? scheme : "" };
  } catch {
    return { host: "", scheme: "" };
  }
}

function knownHost(value: string): boolean {
  return HOSTS.some(h => value === h || value.endsWith(`.${h}`));
}

function tokens(el: Element): string[] {
  return `${el.id} ${el.getAttribute("class") || ""}`.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^a-zA-Z]+/).filter(Boolean);
}

function block(el: HTMLElement, isItem: (el: HTMLElement) => boolean,
               resolve: (el: Element) => ItemScope | null, adapter?: SiteAdapter): HTMLElement | null {
  if (protectedByAdapter(el, adapter)) return null;
  const scope = resolve(el);
  if (scope) return scope.key;

  // A web component may be a single item or an entire feed. Never cross a
  // collection boundary merely because its enclosing host is compact.
  let component: HTMLElement | undefined;
  for (let node: Element | null = el; node && !node.matches(PAGE);) {
    if (node.matches(COLLECTION) || adapter?.rules.some(rule => node!.matches(rule.selector))) break;
    // Article semantics define a block for ordinary posts and paid placements alike.
    if (node instanceof HTMLElement && isItem(node)) return node;
    if (!component && node instanceof HTMLElement && node.shadowRoot &&
        !node.querySelector(COLLECTION) && !node.shadowRoot.querySelector(COLLECTION) && visible(node) &&
        node.getBoundingClientRect().height <= Math.max(innerHeight * 2, 1600)) component = node;
    node = renderedParent(node);
  }
  if (component) return component;
  let target = el;
  while (INLINE.test(target.tagName) && target.parentElement && !target.parentElement.matches(PAGE)) target = target.parentElement;
  return target;
}

export function discover(root: Element, onShadow?: (root: ShadowRoot) => void,
                         url = new URL(location.href)): HTMLElement[] {
  if (root.closest(EXCLUDED)) return [];
  const isItem = itemBoundaries(visible);
  const adapter = adapterFor(url);
  const resolve = ownershipResolver(url);
  const media: HTMLElement[] = [];
  const nodes = textNodes(root, onShadow, element => {
    if (element.matches(MEDIA) && visible(element)) media.push(element);
  });
  const blocks = new Set<HTMLElement>();
  for (const node of nodes) {
    const target = block(node.parentElement!, isItem, resolve, adapter);
    if (!target || (target.matches(PAGE) && !resolve(target))) continue;
    blocks.add(target);
  }
  // Every rendered media block is eligible, including benign frames. Jev alone
  // determines whether its available metadata supports removal.
  for (const element of media) {
    const target = block(element, isItem, resolve, adapter);
    if (target) blocks.add(target);
  }
  // Candidate discovery is intentionally semantic-neutral; Jev classifies every block.
  for (const el of blocks) {
    for (let parent = renderedParent(el); parent; parent = renderedParent(parent)) {
      if (!(parent instanceof HTMLElement) || !blocks.has(parent)) continue;
      const scope = resolve(parent);
      if (!scope || scope.nodes.some(node => containsRendered(node, el))) blocks.delete(parent);
    }
  }
  return [...blocks];
}

export function evidence(el: HTMLElement, url = new URL(location.href)): Evidence {
  // This synchronous read cannot span page mutations. Discard the cache on
  // return: freshness checks after inference must observe the current DOM.
  const visibility = new WeakMap<Element, boolean>();
  const isVisible = (element: Element): element is HTMLElement => {
    if (!visibility.has(element)) visibility.set(element, visible(element));
    return visibility.get(element)!;
  };
  const anchors: HTMLElement[] = [];
  const media: HTMLElement[] = [];
  const scope = ownership(el, url);
  const nodes = (scope?.nodes || [el]).flatMap(root => textNodes(root, undefined, element => {
    if (!element.matches(`a[href],${MEDIA}`) || !isVisible(element)) return;
    if (element.matches("a[href]")) anchors.push(element);
    if (element.matches(MEDIA)) media.push(element);
  }, isVisible));
  const mediaDescriptions = media.flatMap(node => {
    const descriptions = [node.getAttribute("alt") || ""];
    for (const [attribute, label] of [["title", "Media title"], ["aria-label", "Media label"], ["aria-description", "Media description"]]) {
      const value = node.getAttribute(attribute)?.trim();
      if (value) descriptions.push(`${label}: ${value}`);
    }
    return descriptions;
  });
  const fullText = [...nodes.map(node => node.data.trim()), ...mediaDescriptions].join(" ").replace(/\s+/g, " ").trim();
  const links = anchors.map(a => {
    const destination = address(a.getAttribute("href"));
    return { label: text(a, isVisible).slice(0, 160), destination_host: destination.host, destination_scheme: destination.scheme };
  });
  const frame = media.find(node => node.matches("iframe")) || media[0];
  const source = address(frame?.getAttribute("src") ?? frame?.getAttribute("data") ?? null);
  const label = nodes.find(n => LABEL.test(n.data.trim()))?.data.trim() || "";
  const attributes = [...new Set([el, frame].flatMap(node => node ? [...node.attributes].map(a => a.name) : []))]
    .filter(name => /^data-(ad(?:-|$)|sponsored$|actirise$)/.test(name)).slice(0, 8);
  // Provider attributes remain observable even when a managed ad iframe uses about:blank.
  const network = attributes.includes("data-actirise") ? "Actirise" : "";
  return {
    text: fullText.slice(0, MAX_TEXT), links: links.slice(0, 8),
    ad: { tag: el.tagName.toLowerCase().slice(0, 20), tokens: tokens(el).join(" ").slice(0, 160), label: label.slice(0, 100),
      source_host: source.host, source_scheme: source.scheme,
      known_host: [source.host, ...links.map(l => l.destination_host)].some(knownHost), attributes, network },
    // A textless player has no safety metadata; a keep result does not check its contents.
    complete: fullText.length <= MAX_TEXT && links.length <= 8 &&
      (fullText.length > 0 || !media.some(node => node.matches("video,iframe"))),
    text_truncated: fullText.length > MAX_TEXT,
    media_revisions: media.length ? [...media, ...anchors, ...media.flatMap(node => [...node.querySelectorAll("source")])]
      .map(mediaIdentity) : [],
    ownership_revision: scope ? ownershipFingerprint(scope) : "",
  };
}

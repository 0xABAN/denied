import { OWN, type Candidate } from "./contracts";

const EXCLUDED = `script,style,noscript,template,head,svg,input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[hidden],[${OWN}]`;
const PAGE = "html,body,main,nav,header,footer,form,ul,ol,table";
const INLINE = /^(SPAN|A|STRONG|EM|B|I|SMALL|MARK|LABEL)$/;
const AD_TOKEN = /^(ads?|advertisement|advertising|adslot|adsbygoogle|sponsored|sponsor|banner|taboola|outbrain)$/i;
const LABEL = /^(advertisement|sponsored(?: content)?|paid partnership|promoted|anzeige|werbung)$/i;
const HOSTS = ["doubleclick.net", "googlesyndication.com", "googleadservices.com", "taboola.com", "outbrain.com", "amazon-adsystem.com"];
const AD_SELECTOR = "iframe,ins,[data-ad],[data-ad-slot],[data-ad-unit],[data-sponsored],[data-actirise]";
const MAX_TEXT = 24000;
export type Evidence = Omit<Candidate, "id" | "revision"> & { complete: boolean; text_truncated: boolean };

export function visible(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected || el.closest(EXCLUDED)) return false;
  const style = getComputedStyle(el);
  return el.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function textNodes(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent?.trim() && node.parentElement && visible(node.parentElement)) nodes.push(node as Text);
  }
  return nodes;
}

function text(root: Element): string {
  return textNodes(root).map(n => n.data.trim()).join(" ").replace(/\s+/g, " ").trim();
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

function block(el: HTMLElement): HTMLElement {
  let target = el;
  while (INLINE.test(target.tagName) && target.parentElement && !target.parentElement.matches(PAGE)) target = target.parentElement;
  return target;
}

/** Only climb tight wrappers. A label must never authorize removing its whole feed. */
function adContainer(el: HTMLElement): HTMLElement {
  let target = block(el);
  for (let depth = 0; depth < 4; depth++) {
    const parent = target.parentElement;
    if (!parent || parent.matches(PAGE) || parent.querySelector("h1,main,form") || parent.children.length > 6) break;
    const r = parent.getBoundingClientRect();
    const current = target.getBoundingClientRect();
    if (r.width * r.height > innerWidth * innerHeight * 0.5 ||
        r.width * r.height > Math.max(current.width * current.height * 2, 5000)) break;
    const nodes = textNodes(parent);
    if (nodes.filter(n => LABEL.test(n.data.trim())).length > 1 || nodes.map(n => n.data).join("").length > 3000) break;
    target = parent;
    if (target.matches("article,li,[role=dialog]")) break;
  }
  return target;
}

function inside(el: HTMLElement | null, candidates: Set<HTMLElement>): boolean {
  for (let parent = el; parent; parent = parent.parentElement) if (candidates.has(parent)) return true;
  return false;
}

export function discover(root: Element): HTMLElement[] {
  if (root.closest(EXCLUDED)) return [];
  const ads = new Set<HTMLElement>();
  const elements = [root, ...root.querySelectorAll(`${AD_SELECTOR},[id],[class],a[href]`)];
  for (const el of elements) {
    if (!visible(el) || el.matches(PAGE)) continue;
    if (el.matches(AD_SELECTOR) || tokens(el).some(t => AD_TOKEN.test(t)) ||
        (el.matches("a[href]") && knownHost(address(el.getAttribute("href")).host))) ads.add(adContainer(el));
  }
  const nodes = textNodes(root);
  for (const node of nodes) {
    if (LABEL.test(node.data.trim())) ads.add(adContainer(node.parentElement!));
  }
  const outerAds = new Set([...ads].filter(el => !inside(el.parentElement, ads)));
  const blocks = new Set<HTMLElement>(outerAds);
  for (const node of nodes) {
    const target = block(node.parentElement!);
    if (target.matches(PAGE) || inside(target, outerAds)) continue;
    blocks.add(target);
  }
  // Prefer descendants for ordinary content, unlike coherent ad cards.
  for (const el of blocks) {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (!outerAds.has(parent)) blocks.delete(parent);
    }
  }
  return [...blocks];
}

export function evidence(el: HTMLElement): Evidence {
  const fullText = text(el);
  const anchors = el.matches("a[href]") ? [el] : [...el.querySelectorAll("a[href]")];
  const links = anchors.filter(visible).map(a => {
    const destination = address(a.getAttribute("href"));
    return { label: text(a).slice(0, 160), destination_host: destination.host, destination_scheme: destination.scheme };
  });
  const frame = el.matches("iframe") ? el : el.querySelector("iframe[src]");
  const source = address(frame?.getAttribute("src") ?? null);
  const label = textNodes(el).find(n => LABEL.test(n.data.trim()))?.data.trim() || "";
  const attributes = [...new Set([el, frame].flatMap(node => node ? [...node.attributes].map(a => a.name) : []))]
    .filter(name => /^data-(ad(?:-|$)|sponsored$|actirise$)/.test(name)).slice(0, 8);
  // Provider attributes remain observable even when a managed ad iframe uses about:blank.
  const network = attributes.includes("data-actirise") ? "Actirise" : "";
  return {
    text: fullText.slice(0, MAX_TEXT), links: links.slice(0, 8),
    ad: { tag: el.tagName.toLowerCase().slice(0, 20), tokens: tokens(el).join(" ").slice(0, 160), label: label.slice(0, 100),
      source_host: source.host, source_scheme: source.scheme,
      known_host: [source.host, ...links.map(l => l.destination_host)].some(knownHost), attributes, network },
    complete: fullText.length <= MAX_TEXT && links.length <= 8, text_truncated: fullText.length > MAX_TEXT,
  };
}

/** Preserve overlap at passage boundaries; all passages share one DOM removal target. */
export function passages(text: string): string[] {
  if (!text) return [""];
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += 900) {
    parts.push(text.slice(start, start + 1000));
    if (start + 1000 >= text.length) break;
  }
  return parts;
}

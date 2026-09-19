import { DEFAULTS, MAX_BATCH, OWN, judgmentsFrom, zeroCounts, type Batch, type Candidate, type Decision, type PageStats, type Settings } from "./contracts";
import { discover, evidence, passages, visible, type Evidence } from "./scan";
import { clearHighlights, highlight, notify, removeElement } from "./effects";

type Target = {
  id: string; revision: number; fingerprint: string; value: Evidence; parts: string[];
  next: number; results: Decision[]; attempts: number; retryAt: number;
  state: "pending" | "checking" | "checked" | "animating" | "failed";
};
const documentId = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
const records = new Map<HTMLElement, Target>();
const roots = new Set<Element>();
const counts = zeroCounts();
let settings: Settings = { ...DEFAULTS };
let pageUrl = location.href;
let generation = 0;
let sequence = 0;
let busy = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastError: string | null = null;
let policyVersion = "";
let overflow = 0;
let skipped = new WeakSet<HTMLElement>();

function stats(): PageStats {
  const values = [...records.values()];
  return { ...counts, checked: values.filter(t => t.state === "checked" && t.value.complete).length,
    pending: values.filter(t => ["pending", "checking", "animating"].includes(t.state)).length,
    deferred: overflow + values.filter(t => !t.value.complete || t.state === "failed").length, error: lastError };
}

function schedule(delay = 600): void {
  // Leading-edge scheduling prevents continuous mutations from starving the queue.
  if (timer === undefined && settings.enabled) timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
}

function reset(): void {
  generation++;
  records.clear();
  roots.clear();
  clearHighlights();
  overflow = 0;
  skipped = new WeakSet();
  lastError = null;
  pageUrl = location.href;
  if (document.body && settings.enabled) roots.add(document.body);
  schedule();
}

function collect(): void {
  for (const el of records.keys()) if (!el.isConnected) records.delete(el);
  const found = new Set<HTMLElement>();
  for (const root of roots) if (root.isConnected) discover(root).forEach(el => found.add(el));
  roots.clear();
  const sorted = [...found].sort((a, b) => Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top));
  for (const el of sorted) {
    // A coherent ad card supersedes an earlier paragraph target from a partial mutation scan.
    if ([...records.keys()].some(parent => parent !== el && parent.contains(el))) continue;
    for (const child of records.keys()) if (child !== el && el.contains(child)) records.delete(child);
    const previous = records.get(el);
    // ponytail: retain 300 targets; evict checked offscreen targets before deferring more work.
    if (!previous && records.size >= 300) {
      const evict = [...records].find(([node, target]) => {
        const bounds = node.getBoundingClientRect();
        return target.state === "checked" && (bounds.bottom < 0 || bounds.top > innerHeight);
      });
      if (evict) records.delete(evict[0]);
      else {
        if (!skipped.has(el)) { skipped.add(el); overflow++; }
        continue;
      }
    }
    if (skipped.delete(el)) overflow--;
    const value = evidence(el);
    const fingerprint = JSON.stringify(value);
    if (previous?.fingerprint === fingerprint) continue;
    records.set(el, { id: previous?.id || String(++sequence), revision: (previous?.revision || 0) + 1,
      fingerprint, value, parts: passages(value.text), next: 0, results: [], attempts: 0, retryAt: 0, state: "pending" });
  }
}

function current(el: HTMLElement, target: Target, epoch: number, url: string): boolean {
  return settings.enabled && generation === epoch && location.href === url && el.isConnected &&
    records.get(el) === target && JSON.stringify(evidence(el)) === target.fingerprint;
}

async function apply(el: HTMLElement, target: Target, epoch: number, url: string): Promise<void> {
  const hits = target.results.filter(r => r.remove);
  if (!hits.length) {
    target.state = target.next === target.parts.length ? "checked" : "pending";
    return;
  }
  const result: Decision = { ...hits[0], reasons: [...new Set(hits.flatMap(r => r.reasons))] };
  if (settings.mode === "highlight") {
    highlight(el, result);
    target.state = "checked";
    return;
  }
  target.state = "animating";
  const removed = await removeElement(el, settings, () => settings.mode === "remove" && current(el, target, epoch, url));
  if (removed) {
    counts.total++;
    for (const reason of result.reasons) counts[reason]++;
    void chrome.runtime.sendMessage({ type: "counts", counts: { ...counts } }).catch(() => {});
    if (settings.toast) notify(`denied. ${counts.total} removed · ${counts.advertising} ads · ${counts.unsafe_content} unsafe`);
    records.delete(el);
  } else if (el.isConnected) {
    if (records.get(el) === target) records.delete(el);
    roots.add(el);
    schedule();
  }
}

async function flush(): Promise<void> {
  if (!settings.enabled) return;
  if (location.href !== pageUrl) reset();
  collect();
  if (busy) return;
  const epoch = generation;
  const url = location.href;
  const selected: { el: HTMLElement; target: Target; index: number; candidate: Candidate }[] = [];
  for (const [el, target] of records) {
    if (target.state !== "pending" || target.retryAt > Date.now() || !visible(el)) continue;
    while (target.next < target.parts.length && selected.length < MAX_BATCH) {
      const index = target.next++;
      selected.push({ el, target, index, candidate: { id: `${target.id}:${index}`, revision: target.revision,
        text: target.parts[index], links: target.value.links, ad: target.value.ad } });
    }
    if (selected.some(item => item.target === target)) target.state = "checking";
    if (selected.length === MAX_BATCH) break;
  }
  if (!selected.length) {
    if ([...records.values()].some(t => t.state === "pending")) schedule(3000);
    return;
  }
  const batch: Batch = { document_id: documentId, page_host: location.hostname,
    page_scheme: location.protocol.slice(0, -1), candidates: selected.map(s => s.candidate) };
  busy = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "judge", batch });
    if (response?.error) throw new Error(response.error);
    const body = judgmentsFrom(response, batch);
    if (generation !== epoch || location.href !== url || !settings.enabled) return;
    if (policyVersion && policyVersion !== body.policy_version) {
      for (const [el, target] of records) if (target.state === "checked") records.delete(el);
      if (document.body) roots.add(document.body);
    }
    policyVersion = body.policy_version;
    const results = new Map(body.results.map(r => [r.id, r]));
    const targets = new Map<HTMLElement, Target>();
    for (const item of selected) {
      if (!current(item.el, item.target, epoch, url)) {
        if (item.el.isConnected && settings.enabled) roots.add(item.el);
        continue;
      }
      item.target.results.push(results.get(item.candidate.id)!);
      targets.set(item.el, item.target);
    }
    for (const [el, target] of targets) void apply(el, target, epoch, url);
    if (![...records.values()].some(t => t.state === "failed")) lastError = null;
  } catch (error) {
    if (generation !== epoch || !settings.enabled) return;
    lastError = error instanceof Error ? error.message : "Checking unavailable";
    const failed = new Set<Target>();
    for (const { el, target, index } of selected) {
      if (records.get(el) !== target) continue;
      target.next = Math.min(target.next, index);
      failed.add(target);
    }
    for (const target of failed) {
      target.attempts++;
      target.state = target.attempts < 2 ? "pending" : "failed";
      target.retryAt = Date.now() + 3000;
    }
  } finally {
    busy = false;
    if (roots.size || [...records.values()].some(t => t.state === "pending")) schedule();
  }
}

const observer = new MutationObserver(mutations => {
  if (!settings.enabled) return;
  for (const mutation of mutations) {
    const root = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    if (!root || root.closest(`[${OWN}]`)) continue;
    if (mutation.type === "attributes" && mutation.attributeName === "style" && records.get(root as HTMLElement)?.state === "animating") continue;
    if (mutation.type === "childList" && [...mutation.addedNodes, ...mutation.removedNodes].every(n => n instanceof Element && n.hasAttribute(OWN))) continue;
    let tracked: Element | null = root;
    while (tracked && !records.has(tracked as HTMLElement)) tracked = tracked.parentElement;
    if (tracked) roots.add(tracked);
    else if (mutation.type === "childList") {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element && !node.closest(`[${OWN}]`)) roots.add(node);
        else if (node instanceof Text) roots.add(root);
      }
    } else roots.add(root);
  }
  if (roots.size > 50) { roots.clear(); roots.add(document.body); }
  schedule();
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === "pageStats") respond({ ...stats(), ...(message.debug ? {
    debug: { busy, roots: roots.size, targets: [...records].filter(([, t]) => ["pending", "checking"].includes(t.state)).map(([el, t]) => ({ id: t.id, state: t.state, visible: visible(el), next: t.next, parts: t.parts.length, results: t.results.length })) },
  } : {}) });
  if (message?.type === "rescan") { reset(); respond({ ok: true }); }
  if (message?.type === "settingsChanged") { settings = message.settings; reset(); respond({ ok: true }); }
});

void chrome.runtime.sendMessage({ type: "settings" }).then(response => {
  if (response?.error) throw new Error(response.error);
  settings = response.settings;
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["href", "src", "class", "id", "style", "hidden", "aria-label", "data-ad", "data-ad-slot", "data-sponsored", "data-actirise"] });
  reset();
  let scrollTimer: ReturnType<typeof setTimeout>;
  addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { if (settings.enabled) { roots.add(document.body); schedule(); } }, 400);
  }, { passive: true });
  addEventListener("popstate", reset);
  addEventListener("hashchange", reset);
  // SPA pushState can change the route without a DOM mutation.
  setInterval(() => { if (location.href !== pageUrl) reset(); }, 1000);
}).catch(() => { lastError = "Extension unavailable; reload this page"; });

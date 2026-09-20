import { DEFAULTS, OWN, MAX_BATCH, judgmentsFrom, zeroCounts, type Batch, type Candidate, type Decision, type PageStats, type Removal, type Settings } from "./contracts";
import { discover, evidence, owns, visibleItem, type Evidence } from "./scan";
import { renderedParent } from "./dom";
import { ownershipAttributes } from "./adapters";
import { clearHighlights, highlight, notify, removeElement } from "./effects";
import { requestBatches } from "./scheduling";

type Target = {
  id: string; revision: number; fingerprint: string; value: Evidence;
  attempts: number; retryAt: number;
  detectedTick: number;
  state: "pending" | "checking" | "checked" | "animating" | "failed";
};
type Selected = { el: HTMLElement; target: Target; candidate: Candidate };
const documentId = Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
const records = new Map<HTMLElement, Target>();
const roots = new Set<Element>();
const counts = zeroCounts();
let settings: Settings = { ...DEFAULTS };
let pageUrl = location.href;
let generation = 0;
let sequence = 0;
let activeWaves = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastError: string | null = null;
let recordingError: string | null = null;
let policyVersion = "";
let overflow = 0;
let skipped = new WeakSet<HTMLElement>();
const mutationOptions: MutationObserverInit = {
  subtree: true, childList: true, characterData: true, attributes: true,
  attributeFilter: ["href", "src", "srcset", "poster", "data", "type", "title", "alt", "aria-description", "itemprop",
    "class", "id", "style", "hidden", "aria-label", "slot", "data-ad", "data-ad-slot", "data-sponsored", "data-actirise",
    ...ownershipAttributes()],
};

function stats(): PageStats {
  const result = { ...counts, checked: 0, pending: 0, deferred: overflow,
    error: lastError, recording_error: recordingError };
  for (const target of records.values()) {
    if (target.state === "checked" && target.value.complete) result.checked++;
    if (["pending", "checking", "animating"].includes(target.state)) result.pending++;
    if (!target.value.complete || target.state === "failed") result.deferred++;
  }
  return result;
}

function schedule(delay = 600): void {
  // Leading-edge scheduling prevents continuous mutations from starving the queue.
  if (timer === undefined && settings.enabled) timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
}

function reset(): void {
  // An explicit rescan/navigation gets immediate dispatch, not the old wave's timer.
  clearTimeout(timer);
  timer = undefined;
  generation++;
  records.clear();
  roots.clear();
  clearHighlights();
  overflow = 0;
  skipped = new WeakSet();
  lastError = null;
  recordingError = null;
  pageUrl = location.href;
  if (document.body && settings.enabled) roots.add(document.body);
  schedule(0);
}

function collect(): void {
  for (const el of records.keys()) if (!el.isConnected) records.delete(el);
  if (!roots.size) return;
  const found = new Set<HTMLElement>();
  for (const root of roots) if (root.isConnected) {
    discover(root, shadow => observer.observe(shadow, mutationOptions)).forEach(el => found.add(el));
  }
  roots.clear();
  // Index only actual ancestry for this synchronous pass, not every target pair.
  // Include discoveries that may become records before a containing item does.
  const descendants = new Map<Element, HTMLElement[]>();
  for (const child of new Set([...records.keys(), ...found])) {
    for (let parent = renderedParent(child); parent; parent = renderedParent(parent)) {
      const children = descendants.get(parent);
      if (children) children.push(child);
      else descendants.set(parent, [child]);
    }
  }
  const sorted = [...found].map(el => ({ el, distance: Math.abs(el.getBoundingClientRect().top) }))
    .sort((a, b) => a.distance - b.distance);
  for (const { el } of sorted) {
    // Only an item's owned regions supersede fragments. Replies can be physical
    // descendants without belonging to the parent post's classification/removal.
    let covered = false;
    for (let parent = renderedParent(el); parent; parent = renderedParent(parent)) {
      if (!(parent instanceof HTMLElement)) continue;
      const target = records.get(parent);
      if (!target || !owns(parent, el)) continue;
      if (JSON.stringify(evidence(parent)) === target.fingerprint) covered = true;
      else records.delete(parent);
    }
    if (covered) continue;
    for (const child of descendants.get(el) || []) {
      if (records.has(child) && owns(el, child)) records.delete(child);
    }
    const previous = records.get(el);
    // Retain enough targets to fill a wave; recycle checked offscreen targets.
    if (!previous && records.size >= MAX_BATCH * 2) {
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
      fingerprint, value, attempts: 0, retryAt: 0, state: "pending",
      detectedTick: performance.now() });
  }
}

function applicable(el: HTMLElement, target: Target, epoch: number, url: string): boolean {
  return settings.enabled && generation === epoch && location.href === url && el.isConnected && records.get(el) === target;
}

function current(el: HTMLElement, target: Target, epoch: number, url: string): boolean {
  return applicable(el, target, epoch, url) && JSON.stringify(evidence(el)) === target.fingerprint;
}

async function apply(el: HTMLElement, target: Target, result: Decision, epoch: number, url: string): Promise<void> {
  if (!result.remove) {
    target.state = "checked";
    return;
  }
  if (settings.mode === "highlight") {
    highlight(el, result);
    target.state = "checked";
    return;
  }
  target.state = "animating";
  const removed = await removeElement(el, settings,
    () => settings.mode === "remove" && current(el, target, epoch, url),
    () => settings.mode === "remove" && applicable(el, target, epoch, url));
  if (removed) {
    // Only an actual, freshness-checked removal is eligible for persistent history.
    if (result.receipt) {
      const removal: Removal = {
        document_id: documentId, target_id: target.id, revision: target.revision,
        removed_text: target.value.text, text_truncated: target.value.text_truncated,
        date: new Date().toISOString(),
        total_ms: Math.round(performance.now() - target.detectedTick),
        passages: [{ receipt: result.receipt, text: target.value.text }],
      };
      void chrome.runtime.sendMessage({ type: "removal", removal }).then(response => {
        if (response?.error && generation === epoch) recordingError = "History unavailable; filtering remains active";
      }).catch(() => { if (generation === epoch) recordingError = "History unavailable; filtering remains active"; });
    }
    counts.total++;
    for (const reason of result.reasons) counts[reason]++;
    void chrome.runtime.sendMessage({ type: "counts", counts: { ...counts } }).catch(() => {});
    if (settings.toast) notify(`noped. ${counts.total} removed · ${counts.advertising} ads · ${counts.unsafe_content} unsafe`);
    records.delete(el);
  } else if (el.isConnected) {
    if (records.get(el) === target) records.delete(el);
    roots.add(el);
    schedule();
  }
}

/** Deliver a completed batch without waiting for sibling batches in the wave. */
async function checkBatch(items: Selected[], context: Omit<Batch, "candidates">, epoch: number, url: string): Promise<void> {
  const batch: Batch = { ...context, candidates: items.map(item => item.candidate) };
  try {
    const response = await chrome.runtime.sendMessage({ type: "judge", batch });
    if (response?.error) throw new Error(response.error);
    const body = judgmentsFrom(response, batch);
    if (generation !== epoch || location.href !== url || !settings.enabled) return;
    if (policyVersion && policyVersion !== body.policy_version) {
      for (const [node, record] of records) if (record.state === "checked") records.delete(node);
      if (document.body) roots.add(document.body);
    }
    policyVersion = body.policy_version;
    const results = new Map(body.results.map(result => [result.id, result]));
    for (const { el, target, candidate } of items) {
      if (!current(el, target, epoch, url)) {
        if (el.isConnected && settings.enabled) roots.add(el);
        continue;
      }
      void apply(el, target, results.get(candidate.id)!, epoch, url);
    }
  } catch (error) {
    if (generation !== epoch || location.href !== url || !settings.enabled) return;
    for (const { el, target } of items) {
      if (records.get(el) !== target) continue;
      target.attempts++;
      target.state = target.attempts < 3 ? "pending" : "failed";
      target.retryAt = Date.now() + 5000;
    }
    lastError = error instanceof Error ? error.message : "Checking unavailable";
  }
}

async function flush(): Promise<void> {
  if (!settings.enabled) return;
  if (location.href !== pageUrl) reset();
  collect();
  const epoch = generation;
  const url = location.href;
  const selected: Selected[] = [];
  for (const [el, target] of records) {
    if (target.state !== "pending" || target.retryAt > Date.now() || !visibleItem(el)) continue;
    // Each revision contains one bounded evidence block. Keep the wire ID stable.
    selected.push({ el, target, candidate: { id: `${target.id}:0`, revision: target.revision,
      text: target.value.text, links: target.value.links, ad: target.value.ad } });
    target.state = "checking";
    if (selected.length === MAX_BATCH) break;
  }
  if (!selected.length) {
    if ([...records.values()].some(t => t.state === "pending")) schedule(3000);
    return;
  }
  const context = { document_id: documentId, page_host: location.hostname,
    page_scheme: location.protocol.slice(0, -1) };
  activeWaves++;
  // Checking targets are excluded above. A new wave can start on time without
  // resending revisions whose requests are still outstanding.
  schedule(0);
  try {
    // Await only for lifecycle bookkeeping, never to gate the next dispatch.
    await Promise.allSettled(requestBatches(selected).map(items => checkBatch(items, context, epoch, url)));
    if (generation === epoch && ![...records.values()].some(t =>
      t.state === "failed" || (t.state === "pending" && t.attempts > 0))) lastError = null;
  } finally {
    activeWaves--;
    if (roots.size || [...records.values()].some(t => t.state === "pending")) schedule();
  }
}

const observer = new MutationObserver(mutations => {
  if (!settings.enabled) return;
  for (const mutation of mutations) {
    const root = mutation.target instanceof ShadowRoot ? mutation.target.host :
      mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    if (!root || root.closest(`[${OWN}]`)) continue;
    if (mutation.type === "attributes" && mutation.attributeName === "style" && records.get(root as HTMLElement)?.state === "animating") continue;
    if (mutation.type === "childList" && [...mutation.addedNodes, ...mutation.removedNodes].every(n => n instanceof Element && n.hasAttribute(OWN))) continue;
    let tracked: Element | null = root;
    while (tracked && !records.has(tracked as HTMLElement)) tracked = renderedParent(tracked);
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
    debug: { busy: activeWaves > 0, activeWaves, roots: roots.size, targets: [...records].filter(([, t]) => ["pending", "checking"].includes(t.state)).map(([el, t]) => ({ id: t.id, state: t.state, visible: visibleItem(el) })) },
  } : {}) });
  if (message?.type === "rescan") { reset(); respond({ ok: true }); }
  if (message?.type === "settingsChanged") { settings = message.settings; reset(); respond({ ok: true }); }
});

void chrome.runtime.sendMessage({ type: "settings" }).then(response => {
  if (response?.error) throw new Error(response.error);
  settings = response.settings;
  observer.observe(document.documentElement, mutationOptions);
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

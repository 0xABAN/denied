import { domainJudgmentFrom, isDomainRequest, MAX_BATCH, zeroCounts, type Batch, type Counts, type DomainJudgment, type DomainRequest, type Removal } from "./contracts";
import { blockedPageUrl, domainRequest } from "./domain-gate";
import { DEFAULTS, apiBase, settingsFrom, startupSettings, type Settings } from "./settings";
import { BLOCKS_PER_REQUEST } from "./scheduling";
import { enqueueJudgment } from "./transport";

type Ledger = { total: Counts; documents: Record<string, Counts> };
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const stored = await chrome.storage.local.get<{ settings?: Partial<Settings>; automaticDefaultsApplied?: boolean }>(
    ["settings", "automaticDefaultsApplied"]);
  if (!stored.automaticDefaultsApplied) {
    await chrome.storage.local.set({
      settings: startupSettings(stored.settings), automaticDefaultsApplied: true,
    });
  }
})();
let writes: Promise<unknown> = Promise.resolve();
let navigationSequence = 0;
type DomainPreflight = { url: string; request: DomainRequest; promise: Promise<DomainJudgment | null> };
const domainPreflights = new Map<number, DomainPreflight>();

async function settings(): Promise<Settings> {
  await ready;
  const stored = await chrome.storage.local.get<{ settings?: Partial<Settings> }>("settings");
  return settingsFrom({ ...DEFAULTS, ...stored.settings });
}

async function request(path: "/health" | "/outcomes" | "/judge-domain", payload?: Removal | DomainRequest): Promise<unknown> {
  const config = await settings();
  const response = await fetch(`${apiBase(config.apiBase)}${path}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : {},
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(10000),
    credentials: "omit", redirect: "error", cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error.slice(0, 200) : `API error ${response.status}`);
  return body;
}

async function checkDomain(domain: DomainRequest): Promise<DomainJudgment | null> {
  const config = await settings();
  if (!config.enabled) return null;
  return domainJudgmentFrom(await request("/judge-domain", domain), domain);
}

function startDomainPreflight(tabId: number, url: string, domain: DomainRequest, force = false): DomainPreflight {
  const existing = domainPreflights.get(tabId);
  if (!force && existing?.url === url && existing.request.page_host === domain.page_host &&
      existing.request.page_scheme === domain.page_scheme) return existing;

  const entry: DomainPreflight = { url, request: domain, promise: checkDomain(domain) };
  domainPreflights.set(tabId, entry);
  void entry.promise.then(judgment => {
    const current = domainPreflights.get(tabId);
    if (!judgment?.block || current !== entry) return;
    return chrome.tabs.update(tabId, { url: blockedPageUrl(chrome.runtime.getURL("")) });
  }).catch(() => {
    // A failed preflight leaves the document or browser error untouched.
  });
  return entry;
}

function validCounts(value: Counts): boolean {
  return value && [value.total, value.advertising, value.unsafe_content].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000) &&
    value.advertising <= value.total && value.unsafe_content <= value.total;
}

/** A cumulative per-document snapshot makes duplicate delivery harmless. One stored value commits the delta. */
function recordCounts(sender: chrome.runtime.MessageSender, counts: Counts): Promise<unknown> {
  if (!validCounts(counts) || sender.tab?.id === undefined || !sender.documentId) throw new Error("Invalid counter update");
  const key = `${sender.tab.id}:${sender.documentId}`;
  const work = writes.then(async () => {
    const { ledger = { total: zeroCounts(), documents: {} } } = await chrome.storage.local.get<{ ledger?: Ledger }>("ledger");
    const state = ledger as Ledger;
    const previous = state.documents[key] || zeroCounts();
    if (counts.total <= previous.total) return;
    if (counts.advertising < previous.advertising || counts.unsafe_content < previous.unsafe_content) return;
    for (const kind of ["total", "advertising", "unsafe_content"] as const) state.total[kind] += counts[kind] - previous[kind];
    state.documents[key] = counts;
    await chrome.storage.local.set({ ledger: state });
    await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab!.id, color: "#e11d48" });
    await chrome.action.setBadgeText({ tabId: sender.tab!.id, text: String(counts.total) });
  });
  writes = work.catch(() => {});
  return work;
}

async function handle(message: any, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== "string") throw new Error("Invalid extension message");
  const popup = sender.url === chrome.runtime.getURL("popup.html");
  const page = sender.tab?.id !== undefined && sender.frameId === 0 && /^https?:/.test(sender.url || "");
  if (!popup && !page) throw new Error("Unsupported message sender");

  switch (message.type) {
    case "settings": return { settings: await settings() };
    case "judge": {
      const config = await settings();
      if (!page || !config.enabled) throw new Error("Filtering is disabled");
      const batch = message.batch as Batch;
      if (!batch || typeof batch.document_id !== "string" || !Array.isArray(batch.candidates) ||
          !batch.candidates.length || batch.candidates.length > BLOCKS_PER_REQUEST) throw new Error("Invalid batch");
      if (new TextEncoder().encode(JSON.stringify(batch)).length > 2_000_000) throw new Error("Batch too large");
      return enqueueJudgment(config.apiBase, batch);
    }
    case "domain": {
      const config = await settings();
      if (!page || !config.enabled || !isDomainRequest(message.domain)) throw new Error("Invalid domain request");
      if (sender.tab?.id === undefined || !sender.url) throw new Error("Missing page navigation context");
      const preflight = startDomainPreflight(sender.tab.id, sender.url, message.domain);
      const judgment = await preflight.promise;
      if (!judgment) throw new Error("Filtering is disabled");
      return { ...judgment, document_id: message.domain.document_id };
    }
    case "removal": {
      if (!page) throw new Error("Removal records require a page");
      const removal = message.removal as Removal;
      if (!removal || typeof removal.document_id !== "string" || typeof removal.removed_text !== "string" ||
          removal.removed_text.length > 24000 || !Array.isArray(removal.passages) ||
          !removal.passages.length || removal.passages.length > MAX_BATCH || JSON.stringify(removal).length > 300000) {
        throw new Error("Invalid removal record");
      }
      // Receipts authenticate the judgment; the shared backend token never enters Chrome.
      // Retry once: the database's deterministic event ID makes an uncertain first write safe.
      try { return await request("/outcomes", removal); }
      catch {
        await new Promise(resolve => setTimeout(resolve, 500));
        return request("/outcomes", removal);
      }
    }
    case "counts":
      if (!page) throw new Error("Counter updates require a page");
      await recordCounts(sender, message.counts);
      return { ok: true };
    case "saveSettings": {
      if (!popup) throw new Error("Only the popup can change settings");
      const config = settingsFrom(message.settings);
      await chrome.storage.local.set({ settings: config });
      const tabs = await chrome.tabs.query({});
      await Promise.all(tabs.map(tab => tab.id === undefined ? undefined :
        chrome.tabs.sendMessage(tab.id, { type: "settingsChanged", settings: config }, { frameId: 0 }).catch(() => {})));
      return { settings: config };
    }
    case "health":
      if (!popup) throw new Error("Only the popup can check the service");
      return request("/health");
    case "totals": {
      if (!popup) throw new Error("Only the popup can read totals");
      await writes;
      const { ledger } = await chrome.storage.local.get<{ ledger?: Ledger }>("ledger");
      return ledger?.total || zeroCounts();
    }
    default: throw new Error("Unknown message type");
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  void handle(message, sender).then(respond, error => respond({ error: error instanceof Error ? error.message : "Extension request failed" }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") void chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => { domainPreflights.delete(tabId); });
chrome.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId !== 0 || !/^https?:/i.test(details.url)) return;
  try {
    const page = new URL(details.url);
    const domain = domainRequest(`navigation-${details.tabId}-${++navigationSequence}`, page.hostname, page.protocol);
    startDomainPreflight(details.tabId, details.url, domain, true);
  } catch {
    // Unsupported or malformed navigation URLs are left to Chrome unchanged.
  }
});
chrome.runtime.onStartup.addListener(() => {
  // Old document IDs cannot replay after a browser restart; preserve only aggregate counts.
  writes = writes.then(async () => {
    const { ledger } = await chrome.storage.local.get<{ ledger?: Ledger }>("ledger");
    if (ledger) await chrome.storage.local.set({ ledger: { total: ledger.total, documents: {} } });
  }).catch(() => {});
});

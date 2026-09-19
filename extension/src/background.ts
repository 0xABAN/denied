import { DEFAULTS, MAX_BATCH, apiBase, judgmentsFrom, settingsFrom, zeroCounts, type Batch, type Counts, type Settings } from "./contracts";

type Ledger = { total: Counts; documents: Record<string, Counts> };
const ready = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
let writes: Promise<unknown> = Promise.resolve();

async function settings(): Promise<Settings> {
  await ready;
  const stored = await chrome.storage.local.get<{ settings?: Partial<Settings> }>("settings");
  return settingsFrom({ ...DEFAULTS, ...stored.settings });
}

async function request(path: "/judge" | "/health", batch?: Batch): Promise<unknown> {
  const config = await settings();
  const response = await fetch(`${apiBase(config.apiBase)}${path}`, {
    method: batch ? "POST" : "GET",
    headers: batch ? { "Content-Type": "application/json" } : {},
    body: batch ? JSON.stringify(batch) : undefined,
    signal: AbortSignal.timeout(10000),
    credentials: "omit", redirect: "error", cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error.slice(0, 200) : `API error ${response.status}`);
  return body;
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
      if (!page || !(await settings()).enabled) throw new Error("Filtering is disabled");
      const batch = message.batch as Batch;
      if (!batch || typeof batch.document_id !== "string" || !Array.isArray(batch.candidates) ||
          !batch.candidates.length || batch.candidates.length > MAX_BATCH || JSON.stringify(batch).length > 128000) throw new Error("Invalid batch");
      return judgmentsFrom(await request("/judge", batch), batch);
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
chrome.runtime.onStartup.addListener(() => {
  // Old document IDs cannot replay after a browser restart; preserve only aggregate counts.
  writes = writes.then(async () => {
    const { ledger } = await chrome.storage.local.get<{ ledger?: Ledger }>("ledger");
    if (ledger) await chrome.storage.local.set({ ledger: { total: ledger.total, documents: {} } });
  }).catch(() => {});
});

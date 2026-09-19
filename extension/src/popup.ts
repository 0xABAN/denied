import { DEFAULTS, type Counts, type PageStats, type Settings } from "./contracts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, text: string) => { element(id).textContent = text; };
let config: Settings = { ...DEFAULTS };

async function send(message: object): Promise<any> {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result;
}

async function activeTab(): Promise<number | undefined> {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
}

async function refresh(): Promise<void> {
  const total = await send({ type: "totals" }) as Counts;
  show("all-total", String(total.total));
  try {
    const id = await activeTab();
    if (id === undefined) throw new Error("No page");
    const stats = await chrome.tabs.sendMessage(id, { type: "pageStats" }, { frameId: 0 }) as PageStats;
    if (!stats) throw new Error("No content script");
    show("page-total", String(stats.total));
    show("history-status", stats.recording_error || "");
    show("page-status", stats.error ? `Checking unavailable: ${stats.error}` :
      !config.enabled ? "Paused" : `${stats.pending} pending · ${stats.checked} checked · ${stats.deferred} unchecked/deferred`);
  } catch {
    show("page-status", "Not available on this page. Reload ordinary web pages after installing.");
    show("history-status", "");
  }
}

async function check(): Promise<void> {
  show("service-status", "Checking API…");
  try {
    const result = await send({ type: "health" });
    const history = result.recording_error || `judgment/removal history ${result.recording_enabled ? "on" : "off"}`;
    show("service-status", result.configured ? `API ready · ${history}` : "API connected; set TYPESAFE_API_KEY.");
  } catch { show("service-status", "API unavailable. Start the Python backend and check the origin."); }
}

async function save(): Promise<void> {
  const updated = {
    ...config,
    mode: element<HTMLSelectElement>("mode").value,
    apiBase: element<HTMLInputElement>("apiBase").value,
  };
  config = (await send({ type: "saveSettings", settings: updated })).settings;
  show("error", "");
  await refresh();
}

function action(operation: () => Promise<void>): void {
  void operation().catch(error => show("error", error instanceof Error ? error.message : "Request failed"));
}

element("mode").addEventListener("change", () => action(save));
element("save").addEventListener("click", () => action(async () => { await save(); await check(); }));
element("check").addEventListener("click", () => action(check));
element("rescan").addEventListener("click", () => action(async () => {
  const id = await activeTab();
  if (id === undefined) throw new Error("No active page");
  await chrome.tabs.sendMessage(id, { type: "rescan" }, { frameId: 0 });
  await refresh();
}));

action(async () => {
  config = (await send({ type: "settings" })).settings;
  element<HTMLSelectElement>("mode").value = config.mode;
  element<HTMLInputElement>("apiBase").value = config.apiBase;
  await Promise.all([refresh(), check()]);
  setInterval(() => action(refresh), 1500);
});

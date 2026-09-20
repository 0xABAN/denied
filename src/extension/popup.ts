import { type Counts, type PageStats } from "./contracts";
import { DEFAULTS, type Settings } from "./settings";

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
  } catch { /* The popup still displays saved totals when the active page cannot be scanned. */ }
}

async function save(): Promise<void> {
  const updated = {
    ...config,
    animate: element<HTMLInputElement>("animate").checked,
  };
  config = (await send({ type: "saveSettings", settings: updated })).settings;
  await refresh();
}

function action(operation: () => Promise<void>): void {
  void operation().catch(error => console.warn("noped popup request failed", error));
}

element("animate").addEventListener("change", () => action(save));
element("rescan").addEventListener("click", () => action(async () => {
  const id = await activeTab();
  if (id === undefined) throw new Error("No active page");
  await chrome.tabs.sendMessage(id, { type: "rescan" }, { frameId: 0 });
  await refresh();
}));

action(async () => {
  config = (await send({ type: "settings" })).settings;
  element<HTMLInputElement>("animate").checked = config.animate;
  await refresh();
  setInterval(() => action(refresh), 1500);
});

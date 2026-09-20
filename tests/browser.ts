import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import type { Settings } from "../extension/src/contracts";

/** Use the real popup message boundary, including its startup and validation. */
export async function configureExtension(popup: Page, changes: Partial<Settings>): Promise<Settings> {
  return popup.evaluate(async changes => {
    const current = await chrome.runtime.sendMessage({ type: "settings" });
    if (current.error) throw new Error(current.error);
    const response = await chrome.runtime.sendMessage({ type: "saveSettings", settings: { ...current.settings, ...changes } });
    if (response.error) throw new Error(response.error);
    return response.settings;
  }, changes);
}

/** An isolated real extension profile; callers still own their API and fixtures. */
export async function launchExtension(settings: Partial<Settings>,
  options: Parameters<typeof chromium.launchPersistentContext>[1] = {}) {
  const profile = await mkdtemp(join(tmpdir(), "noped-test-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, ...options,
    args: [`--disable-extensions-except=${resolve("dist")}`, `--load-extension=${resolve("dist")}`, ...options.args || []],
  }).catch(async error => {
    await rm(profile, { recursive: true, force: true });
    throw error;
  });
  const close = async () => {
    try { await context.close(); }
    finally { await rm(profile, { recursive: true, force: true }); }
  };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    const configure = (changes: Partial<Settings>) => configureExtension(popup, changes);
    await configure(settings);
    return { context, popup, worker, configure, close };
  } catch (error) {
    await close();
    throw error;
  }
}

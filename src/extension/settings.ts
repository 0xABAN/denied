export const DEFAULTS = {
  enabled: true, animate: true, toast: true, mode: "remove" as "remove" | "highlight",
  apiBase: "http://127.0.0.1:8765",
};
export type Settings = typeof DEFAULTS;

export function apiBase(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid API URL");
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use an HTTPS API origin or a loopback HTTP origin");
  }
  return url.origin;
}

export function settingsFrom(value: unknown): Settings {
  const s = value as Settings;
  if (!s || [s.enabled, s.animate, s.toast].some(v => typeof v !== "boolean") ||
      !["remove", "highlight"].includes(s.mode)) throw new Error("Invalid settings");
  return { enabled: s.enabled, animate: s.animate, toast: s.toast, mode: s.mode, apiBase: apiBase(s.apiBase) };
}

/** Upgrade legacy paused installs; the worker owns the one-time marker. */
export function startupSettings(saved: Partial<Settings> | undefined): Settings {
  return settingsFrom({ ...DEFAULTS, ...saved, enabled: true, animate: true });
}

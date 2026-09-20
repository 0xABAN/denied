import { DEFAULTS, settingsFrom, type Settings } from "./contracts";

/** Upgrade legacy paused installs once; later explicit preferences still win. */
export function startupSettings(saved: Partial<Settings> | undefined, upgraded: boolean): Settings {
  return settingsFrom({ ...DEFAULTS, ...saved,
    ...(!upgraded ? { enabled: true, animate: true } : {}) });
}

import { expect, test } from "bun:test";
import { DEFAULTS } from "../contracts";
import { startupSettings } from "../settings";

test("fresh installs start scanning with removal effects", () => {
  expect(DEFAULTS.enabled).toBe(true);
  expect(DEFAULTS.animate).toBe(true);
  expect(startupSettings(undefined, false)).toEqual(DEFAULTS);
});

test("one-time upgrade enables protection and effects without losing the API", () => {
  const saved = { ...DEFAULTS, enabled: false, animate: false, apiBase: "http://localhost:9876" };
  expect(startupSettings(saved, false)).toEqual({ ...saved, enabled: true, animate: true });
  expect(startupSettings(saved, true)).toEqual(saved);
});

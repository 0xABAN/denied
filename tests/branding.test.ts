import { expect, test } from "bun:test";

test("extension and visible status messages use noped. branding", async () => {
  const manifest = await Bun.file("extension/manifest.json").json();
  expect(manifest.name).toBe("noped.");
  expect(manifest.action.default_title).toBe("noped.");
  for (const path of ["extension/src/effects.ts", "extension/src/content.ts", "tests/motion-preview.html"]) {
    const source = await Bun.file(path).text();
    expect(source).not.toContain("denied.");
    expect(source).toContain("noped.");
  }
});

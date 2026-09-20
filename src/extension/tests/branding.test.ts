import { expect, test } from "bun:test";

test("extension and visible status messages use noped. branding", async () => {
  const manifest = await Bun.file("src/extension/manifest.json").json();
  expect(manifest.name).toBe("noped.");
  expect(manifest.action.default_title).toBe("noped.");
  for (const path of ["src/extension/effects.ts", "src/extension/content.ts", "src/extension/tests/motion-preview.html"]) {
    const source = await Bun.file(path).text();
    expect(source).not.toContain("denied.");
    expect(source).toContain("noped.");
  }
});

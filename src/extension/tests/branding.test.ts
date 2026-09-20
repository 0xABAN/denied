import { expect, test } from "bun:test";

test("extension and visible status messages use noped. branding", async () => {
  const manifest = await Bun.file("src/extension/manifest.json").json();
  expect(manifest.name).toBe("noped.");
  expect(manifest.action.default_title).toBe("noped.");
  for (const path of ["src/extension/effects.ts", "src/extension/tests/motion-preview.html"]) {
    const source = await Bun.file(path).text();
    expect(source).not.toContain("denied.");
    expect(source).toContain("noped.");
  }

  const content = await Bun.file("src/extension/content.ts").text();
  expect(content).not.toContain("denied.");
});

test("successful removals do not render a fixed analytical toast", async () => {
  const content = await Bun.file("src/extension/content.ts").text();
  const effects = await Bun.file("src/extension/effects.ts").text();
  const settings = await Bun.file("src/extension/settings.ts").text();

  expect(content).not.toContain("notify(");
  expect(effects).not.toContain("position:fixed;right:16px;bottom:16px");
  expect(settings).not.toContain("toast");
});

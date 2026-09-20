import assert from "node:assert/strict";
import { test } from "bun:test";
import { blockedPageUrl, domainRequest } from "../domain-gate";

test("domain requests contain only the current host and scheme", () => {
  assert.deepEqual(domainRequest("document-1", "bad.example", "https:"), {
    document_id: "document-1",
    page_host: "bad.example",
    page_scheme: "https",
  });
});

test("blocked domains redirect to the packaged extension page", () => {
  assert.equal(blockedPageUrl("chrome-extension://abcdefghijklmnop/"),
    "chrome-extension://abcdefghijklmnop/blocked.html");
});

test("the extension can observe top-level navigations before a document loads", async () => {
  const manifest = await Bun.file("src/extension/manifest.json").json();
  assert.ok(manifest.permissions.includes("webNavigation"));
});

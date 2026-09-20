import assert from "node:assert/strict";
import { launchExtension } from "./browser";
import { localAPI, until } from "./api";

const api = await localAPI();
const extension = await launchExtension({ apiBase: api.url, enabled: true, animate: false });

try {
  const blocked = await extension.context.newPage();
  await blocked.route("https://pokerstars.com/**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body><h1>controlled domain test</h1></body></html>",
  }));
  await blocked.goto("https://pokerstars.com/", { waitUntil: "domcontentloaded" });
  await until(() => blocked.url().startsWith("chrome-extension://"), "unsafe domain redirect", 30000);
  assert.match(blocked.url(), /\/blocked\.html$/);
  assert.equal(await blocked.locator("h1").textContent(), ":(");
  assert.equal(await blocked.locator("p").textContent(), "sorry, this page has been noped.");
  assert.equal(await blocked.locator("body").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
  assert.equal(await blocked.locator("h1").evaluate(element => getComputedStyle(element).fontWeight), "800");
  assert.equal(await blocked.locator("p").evaluate(element => getComputedStyle(element).fontWeight), "400");
  assert.equal(await blocked.locator("strong").evaluate(element => getComputedStyle(element).fontWeight), "700");
  console.log("passed: known gambling domain redirects to the packaged noped page");

  const failedNavigation = await extension.context.newPage();
  await failedNavigation.route("https://bet365.com/**", route => route.abort("connectionreset"));
  await failedNavigation.goto("https://bet365.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await until(() => failedNavigation.url().startsWith("chrome-extension://"), "unsafe failed navigation redirect", 30000);
  assert.match(failedNavigation.url(), /\/blocked\.html$/);
  assert.equal(await failedNavigation.locator("p").textContent(), "sorry, this page has been noped.");
  console.log("passed: unsafe domain redirects even when the original navigation resets");

  const allowed = await extension.context.newPage();
  await allowed.route("https://www.youtube.com/**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><html><body><h1>controlled ordinary domain test</h1></body></html>",
  }));
  await allowed.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  assert.equal(await allowed.locator("h1").textContent(), "controlled ordinary domain test");
  assert.equal(allowed.url(), "https://www.youtube.com/");
  console.log("passed: ordinary domain remains available after the domain gate");
} finally {
  await extension.close();
  await api.stop();
}

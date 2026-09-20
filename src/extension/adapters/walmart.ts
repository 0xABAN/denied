import type { SiteAdapter } from "./types";

export const walmart: SiteAdapter = {
  id: "walmart", hosts: ["walmart.com", "www.walmart.com"],
  excludedRoutes: /^\/(?:cart|checkout|account)(?:\/|$)/,
  rules: [{ selector: '[role="group"][data-item-id]', content: '[data-automation-id="product-title"]' }],
};

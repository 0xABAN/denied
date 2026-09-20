import type { SiteAdapter } from "./types";

export const facebook: SiteAdapter = {
  id: "facebook", hosts: ["facebook.com", "www.facebook.com"],
  excludedRoutes: /^\/(?:login|recover|settings|messages)(?:\/|$)/,
  rules: [{ selector: '[role="article"]', content: '[dir="auto"], video, img', preserve: '[role="article"], [role="log"]' }],
};

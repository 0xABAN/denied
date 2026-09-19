import type { SiteAdapter } from "./types";

export const threads: SiteAdapter = {
  id: "threads", hosts: ["threads.com", "www.threads.com", "threads.net", "www.threads.net"],
  excludedRoutes: /^\/(?:login|settings)(?:\/|$)/,
  rules: [{ selector: '[data-pressable-container="true"]', content: 'a[href*="/post/"]' }],
};

import type { SiteAdapter } from "./types";

export const tiktok: SiteAdapter = {
  id: "tiktok", hosts: ["tiktok.com", "www.tiktok.com"],
  excludedRoutes: /^\/(?:login|signup|messages|upload)(?:\/|$)/,
  rules: [
    { selector: '[data-e2e="explore-item"]', content: '[data-e2e="explore-card-desc"]' },
    { selector: '[data-e2e="user-post-item"]', content: 'a[href*="/video/"]' },
    { selector: '[data-e2e="recommend-list-item-container"]', content: "video", preserve: '[data-e2e="comment-list"]' },
  ],
};

import type { SiteAdapter } from "./types";

export const bluesky: SiteAdapter = {
  id: "bluesky", hosts: ["bsky.app"],
  excludedRoutes: /^\/(?:settings|messages)(?:\/|$)/,
  rules: [{ selector: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]', content: 'a[href*="/post/"]' }],
};

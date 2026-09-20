import type { SiteAdapter } from "./types";

export const x: SiteAdapter = {
  id: "x", hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"],
  excludedRoutes: /^\/(?:i\/flow|settings|messages|compose)(?:\/|$)/,
  protected: '[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="tweetTextarea_0"], [data-testid="sidebarColumn"]',
  rules: [{ selector: 'article[data-testid="tweet"]', content: '[data-testid="tweetText"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"]' }],
};

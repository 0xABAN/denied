import type { SiteAdapter } from "./types";

export const aliexpress: SiteAdapter = {
  id: "aliexpress", hosts: ["aliexpress.com", "www.aliexpress.com"],
  excludedRoutes: /^\/(?:p\/order|p\/trade|p\/shoppingcart|user)(?:\/|$)/,
  rules: [
    { selector: 'a:has([class*="cards--mainTitle--"])', content: '[class*="cards--mainTitle--"]' },
    { selector: 'a[class*="search-card-item"]', content: 'h3, [class*="title"]' },
  ],
};

import type { SiteAdapter } from "./types";

export const etsy: SiteAdapter = {
  id: "etsy", hosts: ["etsy.com", "www.etsy.com"],
  excludedRoutes: /^\/(?:[a-z]{2}\/)?(?:cart|checkout|your|signin)(?:\/|$)/,
  rules: [
    { selector: "[data-listing-card-v2][data-listing-id]", content: "h3" },
    // The listing cart panel is not the entire product presentation. Leave
    // detail pages to conservative discovery until their full scope is verified.
  ],
};

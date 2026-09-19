import type { SiteAdapter } from "./types";

export const ebay: SiteAdapter = {
  id: "ebay", hosts: ["ebay.com", "www.ebay.com", "ebay.co.uk", "www.ebay.co.uk", "ebay.de", "www.ebay.de"],
  excludedRoutes: /^\/(?:cart|checkout|mye|signin)(?:\/|$)/,
  rules: [
    { selector: "li.s-card[data-listingid]", content: ".s-card__title" },
    { selector: "li.s-item", content: ".s-item__title" },
    { selector: "#mainContent", content: ".x-item-title", parts: ".ux-image-carousel-container, .x-item-title, .x-buybox",
      preserve: ".x-ratings-reviews, .srp-river-results" },
  ],
};

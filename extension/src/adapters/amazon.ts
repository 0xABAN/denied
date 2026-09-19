import type { SiteAdapter } from "./types";

export const amazon: SiteAdapter = {
  id: "amazon", hosts: ["amazon.com", "www.amazon.com", "amazon.ca", "www.amazon.ca", "amazon.co.uk", "www.amazon.co.uk", "amazon.de", "www.amazon.de"],
  excludedRoutes: /^\/(?:gp\/(?:cart|buy|your-account|your-orders)|ap\/|hz\/)/,
  protected: "#nav-main, #navbar, #nav-belt, #nav-flyout-cart",
  rules: [
    { selector: '[data-component-type="s-search-result"][data-asin]', content: "h2" },
    { selector: '[data-hook="review"]', content: '[data-hook="review-body"]' },
    { selector: "#dp", content: "#productTitle", parts: "#leftCol, #centerCol, #rightCol, #productDescription",
      preserve: '#customerReviews, #reviewsMedley, [data-hook="review"], [data-a-carousel-options]' },
  ],
};

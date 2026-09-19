import type { SiteAdapter } from "./types";

export const pinterest: SiteAdapter = {
  id: "pinterest", hosts: ["pinterest.com", "www.pinterest.com"],
  excludedRoutes: /^\/(?:login|settings|messages)(?:\/|$)/,
  rules: [
    { selector: '[data-test-id="pinWrapper"]', content: 'a[href*="/pin/"]' },
    { selector: '[data-test-id="closeup-container"]', content: '[data-test-id="pin-closeup-image"]',
      preserve: '[data-test-id="comments-container"], [data-test-id="related-pins-grid"]' },
  ],
};

import type { SiteAdapter } from "./types";

export const duckduckgo: SiteAdapter = {
  id: "duckduckgo", hosts: ["duckduckgo.com", "www.duckduckgo.com"],
  rules: [{ selector: '.react-results--main > li, article[data-testid="result"]:not(.react-results--main > li article)', content: 'h2, [data-testid="result-title-a"]' }],
};

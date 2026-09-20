import type { SiteAdapter } from "./types";

export const bing: SiteAdapter = {
  id: "bing", hosts: ["bing.com", "www.bing.com"], routes: /^\/search$/,
  rules: [{ selector: "#b_results > li.b_algo, #b_results > li.b_ad > ul > li", content: "h2" }],
};

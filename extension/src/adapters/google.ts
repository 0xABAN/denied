import type { SiteAdapter } from "./types";

export const google: SiteAdapter = {
  id: "google", hosts: ["google.com", "www.google.com", "google.co.uk", "www.google.co.uk", "google.ca", "www.google.ca", "google.de", "www.google.de"],
  routes: /^\/search$/,
  rules: [{ selector: "#rso .MjjYud", content: "h3" }],
};

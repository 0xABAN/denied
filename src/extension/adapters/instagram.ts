import type { SiteAdapter } from "./types";

export const instagram: SiteAdapter = {
  id: "instagram", hosts: ["instagram.com", "www.instagram.com"],
  excludedRoutes: /^\/(?:accounts|direct)(?:\/|$)/,
  rules: [{ selector: "article", content: "video, img", preserve: 'ul:has(> li), [role="textbox"]' }],
};

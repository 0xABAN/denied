import type { SiteAdapter } from "./types";

export const linkedin: SiteAdapter = {
  id: "linkedin", hosts: ["linkedin.com", "www.linkedin.com"],
  excludedRoutes: /^\/(?:login|checkpoint|messaging|mynetwork|settings)(?:\/|$)/,
  rules: [
    { selector: ".feed-shared-update-v2", preserve: ".comments-comments-list, .comments-comment-item, .comments-comment-box" },
    { selector: ".comments-comment-item", content: ".comments-comment-item__main-content, .comments-comment-item-content-body", preserve: ".comments-replies-list" },
  ],
};

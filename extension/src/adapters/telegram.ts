import type { SiteAdapter } from "./types";

export const telegram: SiteAdapter = {
  id: "telegram", hosts: ["web.telegram.org"], routes: /^\/(?:a|k)(?:\/|$)/,
  protected: ".ChatInfo, .chat-input, .input-message-container",
  rules: [
    { selector: "#MiddleColumn .message-list-item", content: ".text-content, .media-inner",
      sharedIdentity: { selector: ".message-title-name, .Avatar" } },
    { selector: "#column-center div.bubble[data-mid]", content: ".message, .media-container" },
  ],
};

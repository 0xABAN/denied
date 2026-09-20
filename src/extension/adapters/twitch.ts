import type { SiteAdapter } from "./types";

export const twitch: SiteAdapter = {
  id: "twitch", hosts: ["twitch.tv", "www.twitch.tv"],
  protected: ".side-nav, .chat-input",
  rules: [
    { selector: "article", content: '[data-a-target="preview-card-image-link"], [data-a-target="preview-card-title-link"]' },
    { selector: ".chat-line__message", content: '[data-a-target="chat-message-text"], .text-fragment' },
    { selector: ".channel-root__main--with-chat", content: '[data-a-target="video-player"]',
      parts: '[data-a-target="video-player"], .channel-info-content', preserve: ".chat-shell, .chat-room" },
  ],
};

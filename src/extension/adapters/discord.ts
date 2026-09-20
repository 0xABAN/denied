import type { SiteAdapter } from "./types";

export const discord: SiteAdapter = {
  id: "discord", hosts: ["discord.com", "canary.discord.com", "ptb.discord.com"], routes: /^\/channels\//,
  rules: [{ selector: '[id^="chat-messages-"]', content: '[id^="message-content-"], [id^="message-accessories-"]',
    sharedIdentity: { selector: '[id^="message-username-"], img[class*="avatar"]' } }],
};

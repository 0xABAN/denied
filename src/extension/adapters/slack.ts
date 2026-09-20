import type { SiteAdapter } from "./types";

export const slack: SiteAdapter = {
  id: "slack", hosts: [".slack.com"], routes: /^\/client\//,
  rules: [{ selector: '[data-qa="virtual-list-item"]', content: '[data-qa="message-text"]',
    sharedIdentity: { selector: '[data-qa="message_sender"], .c-avatar' } }],
};

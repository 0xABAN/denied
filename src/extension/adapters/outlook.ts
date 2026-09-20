import type { SiteAdapter } from "./types";

// A conversation ID is not a message ID. Never target ConversationContainer.
export const outlook: SiteAdapter = {
  id: "outlook", hosts: ["outlook.live.com", "outlook.office.com", "outlook.office365.com"], routes: /^\/mail(?:\/|$)/,
  protected: '[data-app-section="ComposeAction"], [role=listbox]',
  rules: [{ selector: "div[data-item-id]", content: 'div[aria-label="Message body"]:not([contenteditable]), .wide-content-host',
    preserve: '[role="textbox"], [data-app-section="ComposeAction"]' }],
};

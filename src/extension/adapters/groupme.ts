import type { SiteAdapter } from "./types";

// These markers are emitted by GroupMe's deployed Solid message renderers.
export const groupme: SiteAdapter = {
  id: "groupme", hosts: ["web.groupme.com"],
  protected: '[data-testid="chat-compose"], [data-testid="chat-list-pinned-and-recent"], [data-testid="group-and-subgroup-view-header"], [data-testid="dm-view-header"]',
  rules: [{
    selector: "[data-message][data-message-id]",
    sharedIdentity: { row: "[data-message-sender-type]", selector: '[role="button"][aria-label$=" profile"], div:has(> [data-message-date])' },
  }],
};

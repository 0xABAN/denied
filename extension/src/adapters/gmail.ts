import type { SiteAdapter } from "./types";

// Inbox rows can represent multiple emails. Only opened, individual emails expand.
export const gmail: SiteAdapter = {
  id: "gmail", hosts: ["mail.google.com"], routes: /^\/mail\//,
  protected: "tr.zA, .M9, [role=navigation]",
  rules: [{ selector: "div.adn", content: ".a3s", preserve: "div.adn, .ip.iq" }],
};

import type { SiteAdapter } from "./types";

export const whatsapp: SiteAdapter = {
  id: "whatsapp", hosts: ["web.whatsapp.com"], protected: "#pane-side, #main > header, #main > footer",
  rules: [{ selector: "#main .message-in, #main .message-out", content: "[data-id], .copyable-text, .selectable-text" }],
};

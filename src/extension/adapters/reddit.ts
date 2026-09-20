import type { SiteAdapter } from "./types";

export const reddit: SiteAdapter = {
  id: "reddit", hosts: ["reddit.com", "www.reddit.com", "new.reddit.com", "old.reddit.com"],
  protected: "shreddit-composer, reddit-header-large",
  rules: [
    { selector: "shreddit-post", preserve: "shreddit-comment, shreddit-comment-tree" },
    { selector: "shreddit-comment", preserve: '[slot="children"], shreddit-comment' },
    { selector: ".thing.link", content: "a.title", preserve: ".child" },
    { selector: ".thing.comment", content: ".usertext-body", preserve: ".child" },
  ],
};

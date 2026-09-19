import type { SiteAdapter } from "./types";

export const youtube: SiteAdapter = {
  id: "youtube", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com"],
  protected: "ytd-masthead, #guide, ytd-commentbox",
  rules: [
    { selector: "ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, " +
        "ytd-watch-card-compact-video-renderer, ytd-watch-card-hero-video-renderer, " +
        "yt-lockup-view-model:not(ytd-rich-item-renderer yt-lockup-view-model)",
      content: 'a[href*="/watch"], a[href*="/shorts/"]' },
    { selector: "ytd-reel-video-renderer", content: "video", preserve: "ytd-comments, ytd-comment-thread-renderer" },
    { selector: "ytd-comment-renderer, ytd-comment-view-model", content: "#content-text" },
    { selector: "ytd-watch-flexy", content: "#title h1, h1.ytd-watch-metadata",
      parts: "#player-container-outer, #player-container-inner, ytd-watch-metadata, #above-the-fold",
      preserve: "ytd-comments, #comments, #related, ytd-watch-next-secondary-results-renderer" },
  ],
};

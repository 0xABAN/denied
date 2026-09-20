import type { SiteAdapter } from "./types";

/** Explicit ownership rules, not site-specific classification policy. */
export const adapters: readonly SiteAdapter[] = [
  {
    id: "youtube", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com"],
    protected: "ytd-masthead, #guide, ytd-commentbox",
    rules: [
      { selector: "ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, " +
          "ytd-watch-card-compact-video-renderer, ytd-watch-card-hero-video-renderer, " +
          "ytm-shorts-lockup-view-model-v2:not(ytd-rich-item-renderer *), " +
          "ytm-shorts-lockup-view-model:not(ytm-shorts-lockup-view-model-v2 *, ytd-rich-item-renderer *), " +
          "yt-lockup-view-model:not(ytd-rich-item-renderer yt-lockup-view-model)",
        content: 'a[href*="/watch"], a[href*="/shorts/"]' },
      { selector: "ytd-reel-video-renderer", content: "video", preserve: "ytd-comments, ytd-comment-thread-renderer" },
      { selector: "ytd-comment-renderer, ytd-comment-view-model", content: "#content-text" },
      { selector: "ytd-watch-flexy", content: "#title h1, h1.ytd-watch-metadata",
        parts: "#player-container-outer, #player-container-inner, ytd-watch-metadata, #above-the-fold",
        preserve: "ytd-comments, #comments, #related, ytd-watch-next-secondary-results-renderer" },
    ],
  },

  {
    id: "amazon", hosts: ["amazon.com", "www.amazon.com", "amazon.ca", "www.amazon.ca", "amazon.co.uk", "www.amazon.co.uk", "amazon.de", "www.amazon.de"],
    excludedRoutes: /^\/(?:gp\/(?:cart|buy|your-account|your-orders)|ap\/|hz\/)/,
    protected: "#nav-main, #navbar, #nav-belt, #nav-flyout-cart",
    rules: [
      { selector: '[data-component-type="s-search-result"][data-asin]', content: "h2" },
      { selector: '[data-hook="review"]', content: '[data-hook="review-body"]' },
      { selector: "#dp", content: "#productTitle", parts: "#leftCol, #centerCol, #rightCol, #productDescription",
        preserve: '#customerReviews, #reviewsMedley, [data-hook="review"], [data-a-carousel-options]' },
    ],
  },

  {
    id: "x", hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"],
    excludedRoutes: /^\/(?:i\/flow|settings|messages|compose)(?:\/|$)/,
    protected: '[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="tweetTextarea_0"], [data-testid="sidebarColumn"]',
    rules: [{ selector: 'article[data-testid="tweet"]', content: '[data-testid="tweetText"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"]' }],
  },

  // These markers are emitted by GroupMe's deployed Solid message renderers.
  {
    id: "groupme", hosts: ["web.groupme.com"],
    protected: '[data-testid="chat-compose"], [data-testid="chat-list-pinned-and-recent"], [data-testid="group-and-subgroup-view-header"], [data-testid="dm-view-header"]',
    rules: [{
      selector: "[data-message][data-message-id]",
      sharedIdentity: { row: "[data-message-sender-type]", selector: '[role="button"][aria-label$=" profile"], div:has(> [data-message-date])' },
    }],
  },

  {
    id: "reddit", hosts: ["reddit.com", "www.reddit.com", "new.reddit.com", "old.reddit.com"],
    protected: "shreddit-composer, reddit-header-large",
    rules: [
      { selector: "shreddit-post", preserve: "shreddit-comment, shreddit-comment-tree" },
      { selector: "shreddit-comment", preserve: '[slot="children"], shreddit-comment' },
      { selector: ".thing.link", content: "a.title", preserve: ".child" },
      { selector: ".thing.comment", content: ".usertext-body", preserve: ".child" },
    ],
  },

  {
    id: "facebook", hosts: ["facebook.com", "www.facebook.com"],
    excludedRoutes: /^\/(?:login|recover|settings|messages)(?:\/|$)/,
    rules: [{ selector: '[role="article"]', content: '[dir="auto"], video, img', preserve: '[role="article"], [role="log"]' }],
  },

  {
    id: "instagram", hosts: ["instagram.com", "www.instagram.com"],
    excludedRoutes: /^\/(?:accounts|direct)(?:\/|$)/,
    rules: [{ selector: "article", content: "video, img", preserve: 'ul:has(> li), [role="textbox"]' }],
  },

  {
    id: "tiktok", hosts: ["tiktok.com", "www.tiktok.com"],
    excludedRoutes: /^\/(?:login|signup|messages|upload)(?:\/|$)/,
    rules: [
      { selector: '[data-e2e="explore-item"]', content: '[data-e2e="explore-card-desc"]' },
      { selector: '[data-e2e="user-post-item"]', content: 'a[href*="/video/"]' },
      { selector: '[data-e2e="recommend-list-item-container"]', content: "video", preserve: '[data-e2e="comment-list"]' },
    ],
  },

  {
    id: "twitch", hosts: ["twitch.tv", "www.twitch.tv"],
    protected: ".side-nav, .chat-input",
    rules: [
      { selector: "article", content: '[data-a-target="preview-card-image-link"], [data-a-target="preview-card-title-link"]' },
      { selector: ".chat-line__message", content: '[data-a-target="chat-message-text"], .text-fragment' },
      { selector: ".channel-root__main--with-chat", content: '[data-a-target="video-player"]',
        parts: '[data-a-target="video-player"], .channel-info-content', preserve: ".chat-shell, .chat-room" },
    ],
  },

  {
    id: "linkedin", hosts: ["linkedin.com", "www.linkedin.com"],
    excludedRoutes: /^\/(?:login|checkpoint|messaging|mynetwork|settings)(?:\/|$)/,
    rules: [
      { selector: ".feed-shared-update-v2", preserve: ".comments-comments-list, .comments-comment-item, .comments-comment-box" },
      { selector: ".comments-comment-item", content: ".comments-comment-item__main-content, .comments-comment-item-content-body", preserve: ".comments-replies-list" },
    ],
  },

  {
    id: "threads", hosts: ["threads.com", "www.threads.com", "threads.net", "www.threads.net"],
    excludedRoutes: /^\/(?:login|settings)(?:\/|$)/,
    rules: [{ selector: '[data-pressable-container="true"]', content: 'a[href*="/post/"]' }],
  },

  {
    id: "bluesky", hosts: ["bsky.app"],
    excludedRoutes: /^\/(?:settings|messages)(?:\/|$)/,
    rules: [{ selector: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]', content: 'a[href*="/post/"]' }],
  },

  {
    id: "ebay", hosts: ["ebay.com", "www.ebay.com", "ebay.co.uk", "www.ebay.co.uk", "ebay.de", "www.ebay.de"],
    excludedRoutes: /^\/(?:cart|checkout|mye|signin)(?:\/|$)/,
    rules: [
      { selector: "li.s-card[data-listingid]", content: ".s-card__title" },
      { selector: "li.s-item", content: ".s-item__title" },
      { selector: "#mainContent", content: ".x-item-title", parts: ".ux-image-carousel-container, .x-item-title, .x-buybox",
        preserve: ".x-ratings-reviews, .srp-river-results" },
    ],
  },

  {
    id: "etsy", hosts: ["etsy.com", "www.etsy.com"],
    excludedRoutes: /^\/(?:[a-z]{2}\/)?(?:cart|checkout|your|signin)(?:\/|$)/,
    rules: [
      { selector: "[data-listing-card-v2][data-listing-id]", content: "h3" },
      // The listing cart panel is not the entire product presentation. Leave
      // detail pages to conservative discovery until their full scope is verified.
    ],
  },

  {
    id: "walmart", hosts: ["walmart.com", "www.walmart.com"],
    excludedRoutes: /^\/(?:cart|checkout|account)(?:\/|$)/,
    rules: [{ selector: '[role="group"][data-item-id]', content: '[data-automation-id="product-title"]' }],
  },

  {
    id: "aliexpress", hosts: ["aliexpress.com", "www.aliexpress.com"],
    excludedRoutes: /^\/(?:p\/order|p\/trade|p\/shoppingcart|user)(?:\/|$)/,
    rules: [
      { selector: 'a:has([class*="cards--mainTitle--"])', content: '[class*="cards--mainTitle--"]' },
      { selector: 'a[class*="search-card-item"]', content: 'h3, [class*="title"]' },
    ],
  },

  {
    id: "discord", hosts: ["discord.com", "canary.discord.com", "ptb.discord.com"], routes: /^\/channels\//,
    rules: [{ selector: '[id^="chat-messages-"]', content: '[id^="message-content-"], [id^="message-accessories-"]',
      sharedIdentity: { selector: '[id^="message-username-"], img[class*="avatar"]' } }],
  },

  {
    id: "whatsapp", hosts: ["web.whatsapp.com"], protected: "#pane-side, #main > header, #main > footer",
    rules: [{ selector: "#main .message-in, #main .message-out", content: "[data-id], .copyable-text, .selectable-text" }],
  },

  {
    id: "telegram", hosts: ["web.telegram.org"], routes: /^\/(?:a|k)(?:\/|$)/,
    protected: ".ChatInfo, .chat-input, .input-message-container",
    rules: [
      { selector: "#MiddleColumn .message-list-item", content: ".text-content, .media-inner",
        sharedIdentity: { selector: ".message-title-name, .Avatar" } },
      { selector: "#column-center div.bubble[data-mid]", content: ".message, .media-container" },
    ],
  },

  {
    id: "slack", hosts: [".slack.com"], routes: /^\/client\//,
    rules: [{ selector: '[data-qa="virtual-list-item"]', content: '[data-qa="message-text"]',
      sharedIdentity: { selector: '[data-qa="message_sender"], .c-avatar' } }],
  },

  {
    id: "google", hosts: ["google.com", "www.google.com", "google.co.uk", "www.google.co.uk", "google.ca", "www.google.ca", "google.de", "www.google.de"],
    routes: /^\/search$/,
    rules: [{ selector: "#rso .MjjYud", content: "h3" }],
  },

  {
    id: "bing", hosts: ["bing.com", "www.bing.com"], routes: /^\/search$/,
    rules: [{ selector: "#b_results > li.b_algo, #b_results > li.b_ad > ul > li", content: "h2" }],
  },

  {
    id: "duckduckgo", hosts: ["duckduckgo.com", "www.duckduckgo.com"],
    rules: [{ selector: '.react-results--main > li, article[data-testid="result"]:not(.react-results--main > li article)', content: 'h2, [data-testid="result-title-a"]' }],
  },

  // Inbox rows can represent multiple emails. Only opened, individual emails expand.
  {
    id: "gmail", hosts: ["mail.google.com"], routes: /^\/mail\//,
    protected: "tr.zA, .M9, [role=navigation]",
    rules: [{ selector: "div.adn", content: ".a3s", preserve: "div.adn, .ip.iq" }],
  },

  // A conversation ID is not a message ID. Never target ConversationContainer.
  {
    id: "outlook", hosts: ["outlook.live.com", "outlook.office.com", "outlook.office365.com"], routes: /^\/mail(?:\/|$)/,
    protected: '[data-app-section="ComposeAction"], [role=listbox]',
    rules: [{ selector: "div[data-item-id]", content: 'div[aria-label="Message body"]:not([contenteditable]), .wide-content-host',
      preserve: '[role="textbox"], [data-app-section="ComposeAction"]' }],
  },
];

// Temporarily disabled: retained for re-enabling, never an exemption from scanning.
export const pinterest: SiteAdapter = {
  id: "pinterest", hosts: ["pinterest.com", "www.pinterest.com"],
  excludedRoutes: /^\/(?:login|settings|messages)(?:\/|$)/,
  rules: [
    { selector: '[data-test-id="pinWrapper"]', content: 'a[href*="/pin/"]' },
    { selector: '[data-test-id="closeup-container"]', content: '[data-test-id="pin-closeup-image"]',
      preserve: '[data-test-id="comments-container"], [data-test-id="related-pins-grid"]' },
  ],
};

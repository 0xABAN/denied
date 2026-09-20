/** Additional rule shapes. These are synthetic contracts, not live captures. */
export const adapterVariants = ([
  // Search-side watch cards use formatted strings, not ordinary video headings.
  { site: "youtube", rule: 0, renderer: "ytd-watch-card-compact-video-renderer", html: `<section>
    <ytd-watch-card-compact-video-renderer data-fixture="extra">
      <ytd-thumbnail><a href="/watch?v=compact"><img alt=""><span>0:51</span></a></ytd-thumbnail>
      <div><a href="/watch?v=compact"><yt-formatted-string>Season 04 BlackCell Trailer | Black Ops 7</yt-formatted-string></a>
        <yt-formatted-string>Example channel</yt-formatted-string><yt-formatted-string>38K views · 3 months ago</yt-formatted-string></div>
    </ytd-watch-card-compact-video-renderer>
    <ytd-watch-card-compact-video-renderer data-retain><a href="/watch?v=neighbor"><img alt="KEEP_NEIGHBOR">KEEP_NEIGHBOR</a></ytd-watch-card-compact-video-renderer>
    <button data-retain>KEEP_VIEW_ALL</button></section>` },
  { site: "youtube", rule: 0, renderer: "ytd-watch-card-hero-video-renderer", html: `<section>
    <ytd-watch-card-hero-video-renderer data-fixture="extra"><div id="watch-card-endpoint">
      <ytd-thumbnail><a href="/watch?v=hero"></a></ytd-thumbnail><div id="hero-image"><img alt=""></div>
      <a href="/watch?v=hero"><yt-formatted-string id="watch-card-title">Dev Talk - Season 06 Update | Call of Duty: Black Ops 7</yt-formatted-string></a>
      <yt-formatted-string id="watch-card-subtitle">Example channel · 113K views · 3 days ago</yt-formatted-string>
    </div></ytd-watch-card-hero-video-renderer>
    <ytd-watch-card-compact-video-renderer data-retain><a href="/watch?v=neighbor"><img alt="KEEP_NEIGHBOR">KEEP_NEIGHBOR</a></ytd-watch-card-compact-video-renderer>
    <button data-retain>KEEP_VIEW_ALL</button></section>` },
  { site: "youtube", rule: 1, html: '<ytd-reel-video-renderer data-fixture="extra"><video></video><p>Video description</p><ytd-comments data-retain>KEEP_INTERNAL</ytd-comments></ytd-reel-video-renderer>' },
  { site: "youtube", rule: 2, html: '<ytd-comment-view-model data-fixture="extra"><img alt="Avatar"><b>Author</b><div id="content-text">Comment body</div></ytd-comment-view-model>' },
  { site: "youtube", rule: 3, html: '<ytd-watch-flexy data-fixture="extra"><div id="player-container-outer"><video></video></div><ytd-watch-metadata><div id="above-the-fold"><div id="title"><h1>Video title</h1></div></div><div id="description">Description</div></ytd-watch-metadata><div id="comments" data-retain><p id="above-the-fold" data-retain>KEEP_INTERNAL</p></div><div id="related" data-retain><p id="above-the-fold" data-retain>KEEP_INTERNAL</p></div></ytd-watch-flexy>' },
  { site: "amazon", rule: 1, html: '<div data-hook="review" data-fixture="extra"><b>Reviewer</b><div data-hook="review-body">Review body</div></div>' },
  { site: "amazon", rule: 2, html: '<div id="dp" data-fixture="extra"><div id="leftCol"><img alt="Product"></div><div id="centerCol"><h1 id="productTitle">Product title</h1></div><div id="rightCol"><button>Purchase controls</button></div><div id="productDescription">Description</div><div id="customerReviews" data-retain>KEEP_INTERNAL</div></div>' },
  { site: "reddit", rule: 1, html: '<shreddit-comment data-fixture="extra"><p>Comment body</p><div slot="children" data-retain>KEEP_INTERNAL</div></shreddit-comment>' },
  { site: "reddit", rule: 2, html: '<div class="thing link" data-fixture="extra"><a class="title">Post title</a><p>Body</p><div class="child" data-retain>KEEP_INTERNAL</div></div>' },
  { site: "reddit", rule: 3, html: '<div class="thing comment" data-fixture="extra"><b>Author</b><div class="usertext-body">Comment body</div><div class="child" data-retain>KEEP_INTERNAL</div></div>' },
  { site: "tiktok", rule: 1, html: '<div data-e2e="user-post-item" data-fixture="extra"><a href="/author/video/example"><img alt="Preview"><p>Video title</p></a><button>Actions</button></div>' },
  { site: "tiktok", rule: 2, html: '<div data-e2e="recommend-list-item-container" data-fixture="extra"><video></video><p>Caption</p><div data-e2e="comment-list" data-retain>KEEP_INTERNAL</div></div>' },
  { site: "twitch", rule: 1, html: '<div class="chat-line__message" data-fixture="extra"><b>Author</b><span data-a-target="chat-message-text">Chat body</span></div>' },
  { site: "twitch", rule: 2, html: '<div class="channel-root__main--with-chat" data-fixture="extra"><div data-a-target="video-player"><video></video></div><div class="channel-info-content"><h1>Stream title</h1><p>Description</p></div><div class="chat-room" data-retain>KEEP_INTERNAL</div></div>' },
  { site: "pinterest", rule: 1, html: '<div data-test-id="closeup-container" data-fixture="extra"><img data-test-id="pin-closeup-image" alt="Pin"><p>Description</p><div data-test-id="comments-container" data-retain>KEEP_INTERNAL</div><div data-test-id="related-pins-grid" data-retain>KEEP_INTERNAL</div></div>' },
  { site: "linkedin", rule: 1, html: '<div class="comments-comment-item" data-fixture="extra"><b>Author</b><div class="comments-comment-item__main-content">Comment body</div><div class="comments-replies-list" data-retain>KEEP_INTERNAL</div></div>' },
  { site: "ebay", rule: 1, html: '<li class="s-item" data-fixture="extra"><img alt="Product"><h3 class="s-item__title">Product title</h3><button>Actions</button></li>' },
  { site: "ebay", rule: 2, html: '<main id="mainContent" data-fixture="extra"><div class="ux-image-carousel-container"><img alt="Product"></div><h1 class="x-item-title">Product title</h1><div class="x-buybox"><button>Purchase controls</button></div><div class="x-ratings-reviews" data-retain>KEEP_INTERNAL</div></main>' },
  { site: "aliexpress", rule: 1, html: '<a class="search-card-item" data-fixture="extra" href="/item/example"><img alt="Product"><h3>Product title</h3><p>Description</p></a>' },
  { site: "telegram", rule: 1, url: "https://web.telegram.org/k/", html: '<div id="column-center"><div class="bubble" data-mid="example" data-fixture="extra"><div class="message">Message body</div><button>Actions</button></div></div>' },
] as const).filter(variant => variant.site !== "pinterest"); // Keep the fixture while its adapter is disabled.

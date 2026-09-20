/** Minimal structural fixtures, NOT snapshots or proof of live-site coverage.
 * Marker provenance and access limitations are listed in docs/adapters.md.
 * Text, identities, URLs and media are synthetic; no private browsing data.
 */
export const adapterFixtures = ([
  { site: "youtube", url: "https://www.youtube.com/results?search_query=nature", container: "div",
    item: '<ytd-video-renderer data-fixture="$id"><a href="/watch?v=$id"><img alt="Preview"></a><h3><a class="probe" href="/watch?v=$id">$text</a></h3><span>Example channel</span><button>Actions</button></ytd-video-renderer>' },
  { site: "amazon", url: "https://www.amazon.com/s?k=notebook", container: "div",
    item: '<div data-component-type="s-search-result" data-asin="$id" data-fixture="$id"><img alt="Preview"><h2 class="probe">$text</h2><span>Example seller</span><button>Actions</button></div>' },
  { site: "x", url: "https://x.com/home", container: "div",
    item: '<article data-testid="tweet" data-fixture="$id"><div><img alt="Avatar"><b>Example author</b></div><div data-testid="tweetText" class="probe">$text</div><span>Sponsored</span><button>Actions</button></article>' },
  { site: "groupme", url: "https://web.groupme.com/chats", container: 'div data-scrolling-messages-div role="log"',
    item: '<div data-message-sender-type="user"><div data-message data-message-id="$id" data-fixture="$id"><div data-message-interactive-container role="group"><div data-text-message-content><div role="button" aria-label="Example profile"><img alt="Avatar"></div><div>Example author<span data-message-date>Today</span></div><p class="probe">$text</p></div><button data-message-menu>Actions</button></div></div></div>' },
  { site: "reddit", url: "https://www.reddit.com/r/example/", container: "div",
    item: '<shreddit-post post-id="$id" data-fixture="$id"><img alt="Avatar"><b>Example author</b><p class="probe">$text</p><button>Actions</button></shreddit-post>' },
  { site: "facebook", url: "https://www.facebook.com/", container: 'div role="feed"',
    item: '<div role="article" data-fixture="$id"><img alt="Avatar"><b>Example author</b><div dir="auto" class="probe">$text</div><button>Actions</button></div>' },
  { site: "instagram", url: "https://www.instagram.com/", container: "div",
    item: '<article data-fixture="$id"><header>Example author</header><img alt="Photo"><p class="probe">$text</p><button>Actions</button></article>' },
  { site: "tiktok", url: "https://www.tiktok.com/explore", container: 'div data-e2e="explore-item-list"',
    item: '<div data-e2e="explore-item" data-fixture="$id"><img alt="Preview"><div data-e2e="explore-card-desc" class="probe">$text</div><a data-e2e="explore-card-user-link">Example author</a><button>Actions</button></div>' },
  { site: "twitch", url: "https://www.twitch.tv/directory", container: "div",
    item: '<article data-fixture="$id"><a data-a-target="preview-card-image-link" href="/example"><img alt="Preview"></a><h3 class="probe">$text</h3><button>Actions</button></article>' },
  { site: "pinterest", url: "https://www.pinterest.com/", container: "div",
    item: '<div data-test-id="pinWrapper" data-fixture="$id"><a href="/pin/$id"><img alt="Preview"><span class="probe">$text</span></a><button>Actions</button></div>' },
  { site: "linkedin", url: "https://www.linkedin.com/feed/", container: "div",
    item: '<div class="feed-shared-update-v2" data-fixture="$id"><img alt="Avatar"><b>Example author</b><p class="probe">$text</p><button>Actions</button></div>' },
  { site: "threads", url: "https://www.threads.com/", container: "div",
    item: '<div data-pressable-container="true" data-fixture="$id"><a href="/@example/post/$id">Example author</a><img alt="Avatar"><p class="probe">$text</p><button>Actions</button></div>' },
  { site: "bluesky", url: "https://bsky.app/", container: "div",
    item: '<div data-testid="feedItem-by-example.test" data-fixture="$id"><a href="/profile/example.test/post/$id">Example author</a><img alt="Avatar"><p class="probe">$text</p><button>Actions</button></div>' },
  { site: "ebay", url: "https://www.ebay.com/sch/i.html", container: "ul",
    item: '<li class="s-card" data-listingid="$id" data-fixture="$id"><img alt="Preview"><div class="s-card__title probe">$text</div><button>Actions</button></li>' },
  { site: "etsy", url: "https://www.etsy.com/search?q=notebook", container: "div",
    item: '<div data-listing-card-v2 data-listing-id="$id" data-fixture="$id"><a href="/listing/$id"><img alt="Preview"><h3 class="probe">$text</h3></a><button>Actions</button></div>' },
  { site: "walmart", url: "https://www.walmart.com/search?q=notebook", container: "div",
    item: '<div role="group" data-item-id="$id" data-fixture="$id"><img alt="Preview"><span data-automation-id="product-title" class="probe">$text</span><button>Actions</button></div>' },
  { site: "aliexpress", url: "https://www.aliexpress.com/", container: "div",
    item: '<a href="/item/$id.html" data-fixture="$id"><img alt="Preview"><div><h3 class="cards--mainTitle--example probe">$text</h3><span>Example seller</span></div></a>' },
  { site: "discord", url: "https://discord.com/channels/example/channel", container: 'ol data-list-id="chat-messages"',
    item: '<li id="chat-messages-$id" data-fixture="$id"><img class="avatar_example" alt="Avatar"><h3 id="message-username-$id">Example author</h3><div id="message-content-$id" class="probe">$text</div><button>Actions</button></li>' },
  { site: "whatsapp", url: "https://web.whatsapp.com/", container: 'div id="main"',
    item: '<div class="message-in" data-fixture="$id"><div data-id="$id"><b>Example author</b><span class="selectable-text copyable-text probe">$text</span><button>Actions</button></div></div>' },
  { site: "telegram", url: "https://web.telegram.org/a/", container: 'div id="MiddleColumn"',
    item: '<div class="message-list-item" data-fixture="$id"><span class="message-title-name">Example author</span><div class="text-content probe">$text</div><button>Actions</button></div>' },
  { site: "slack", url: "https://app.slack.com/client/example/channel", container: 'div id="message-list"',
    item: '<div data-qa="virtual-list-item" data-fixture="$id"><div class="c-avatar"><img alt="Avatar"></div><b data-qa="message_sender">Example author</b><div data-qa="message-text" class="probe">$text</div><button>Actions</button></div>' },
  { site: "google", url: "https://www.google.com/search?q=garden", container: 'div id="rso"',
    item: '<div class="MjjYud" data-fixture="$id"><a href="https://example.test/$id"><h3 class="probe">$text</h3></a><p>Example result</p><button>Actions</button></div>' },
  { site: "bing", url: "https://www.bing.com/search?q=garden", container: 'ol id="b_results"',
    item: '<li class="b_algo" data-fixture="$id"><a href="https://example.test/$id"><h2 class="probe">$text</h2></a><p>Example result</p><button>Actions</button></li>' },
  { site: "duckduckgo", url: "https://duckduckgo.com/?q=garden", container: 'ol class="react-results--main"',
    item: '<li data-fixture="$id"><article data-testid="result"><a href="https://example.test/$id"><h2 class="probe">$text</h2></a><p>Example result</p><button>Actions</button></article></li>' },
  { site: "gmail", url: "https://mail.google.com/mail/u/0/#inbox/example", container: 'div role="main"',
    item: '<div class="adn" data-legacy-message-id="$id" data-fixture="$id"><img alt="Avatar"><b class="gD">Example sender</b><div class="ii gt"><div class="a3s probe">$text</div></div><button>Actions</button></div>' },
  { site: "outlook", url: "https://outlook.live.com/mail/0/inbox/id/example", container: 'div data-app-section="ConversationContainer"',
    item: '<div data-item-id="$id" data-fixture="$id"><span data-testid="SenderPersona">Example sender</span><div aria-label="Message body" class="probe">$text</div><button>Actions</button></div>' },
] as const).filter(fixture => fixture.site !== "pinterest"); // Keep the fixture while its adapter is disabled.

/** Current public YouTube search structure, with synthetic titles and destinations. */
export function youtubeShortsShelf(id: string, cards: [string, string][]): string {
  return `<grid-shelf-view-model id="${id}">
    <yt-section-header-view-model><yt-shelf-header-layout><h2>Shorts</h2></yt-shelf-header-layout></yt-section-header-view-model>
    <div><div class="ytGridShelfViewModelGridShelfRow">
      ${cards.map(([key, title]) => `<div class="ytGridShelfViewModelGridShelfItem"><div>
        <ytm-shorts-lockup-view-model-v2 id="${key}"><ytm-shorts-lockup-view-model>
          <a href="/shorts/${key}"><img alt=""></a>
          <div><h3><a href="/shorts/${key}">${title}</a></h3><span>Example channel</span><button>Actions</button></div>
        </ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model-v2>
      </div></div>`).join("")}
    </div><div class="ytGridShelfViewModelGridShelfRow"></div></div>
    <div class="ytGridShelfViewModelGridShelfBottomButtonContainer"><div><button>Show more</button></div></div>
  </grid-shelf-view-model>`;
}

export function fixturePage(fixture: typeof adapterFixtures[number]): string {
  const item = (id: string, text: string) => fixture.item.replaceAll("$id", id).replaceAll("$text", text);
  return `<!doctype html><html><head><title>denied adapter fixture</title><style>
    body { font: 16px sans-serif; } [data-fixture] { display: block; padding: 12px; margin: 12px; }
    img { width: 32px; height: 32px; } video { width: 240px; height: 120px; }
  </style></head><body><nav id="navigation">Application navigation</nav>
    <${fixture.container}${fixture.container.includes("id=") ? "" : ' id="collection"'}>
      ${item("target", "Tickets for sale. Send me a message to buy them for $40.")}
      ${item("neighbor", "The school garden has flowers and butterflies.").replace("<span>Sponsored</span>", "")}
    </${fixture.container.split(" ")[0]}>
    <form id="composer"><textarea>DO_NOT_SEND_DRAFT</textarea><input value="DO_NOT_SEND_INPUT"></form>
  </body></html>`;
}

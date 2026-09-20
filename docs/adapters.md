# Site adapters

Adapters identify the item that supplied evidence. They do not classify content, change classifier policy, or introduce per-site blocking rules. A negative result means the existing advertising or under-13 policy returned `remove: true`. The advertising policy includes ordinary sales offers, not only paid placements.

All effects are browser-local DOM changes. Never click a site's delete/archive controls, call account APIs, read drafts, fetch attachments, or collect full-page dumps. Visible chat and email text follows the existing backend/Jev and optional judgment-history path.

Pinterest's adapter is temporarily disabled: 25 adapters remain enabled. Its definition in `src/extension/adapters/catalog.ts` and fixtures are retained for re-enabling. Pinterest uses generic filtering, not a site exemption.

## Ownership definitions

The target is an individual item, never its collection. Main item presentations may span several DOM regions. Replies, reviews, recommendations, composers and shared identity remain independent. Inbox rows that summarize a conversation are not individual emails; mail adapters must not expand them into thread removals.

| Adapter | Item ownership | Protected neighbors |
| --- | --- | --- |
| YouTube | Video card, Short, player with associated metadata; individual comment | Other videos, comments, recommendations, navigation |
| Amazon | Product card or main product presentation; individual review | Other products, reviews, cart/checkout/account UI |
| X | Individual post with author, attachments, badge and actions | Timeline, other posts/replies, composer |
| GroupMe | Individual message with exclusive profile, attachments and actions | Chat history, shared author identity, composer |
| Reddit | Individual post or comment | Independent comments/replies, feeds, composer |
| Facebook | Individual feed post or comment | Other posts/replies, navigation, composer |
| Instagram | Individual post/Reel or comment | Other posts/comments, app navigation, composer |
| TikTok | Individual video card/presentation or comment | Other videos/comments, navigation |
| Twitch | Stream/video card, player with metadata, or chat message | Other streams, chat history, navigation |
| Pinterest | Individual Pin card/presentation | Other Pins, boards and navigation |
| LinkedIn | Individual feed post or comment | Other posts/replies, composer, navigation |
| Threads | Individual post or reply | Other posts/replies, composer, navigation |
| Bluesky | Individual post or reply | Other posts/replies, composer, navigation |
| eBay | Listing card or main listing presentation | Other listings, checkout/account UI |
| Etsy | Listing card or main listing presentation | Other listings, reviews, checkout/account UI |
| Walmart | Product card or main product presentation | Other products, reviews, checkout/account UI |
| AliExpress | Product card or main product presentation | Other products, reviews, checkout/account UI |
| Discord | Individual message with exclusive attachments and controls | Other messages, shared identity, channel UI, composer |
| WhatsApp Web | Individual message with exclusive associated UI | Conversation, shared identity, composer |
| Telegram Web | Individual message with exclusive associated UI | Conversation, shared identity, composer |
| Slack | Individual message with exclusive associated UI | Channel/thread history, shared identity, composer |
| Google Search | Individual result, shopping tile or ad unit | Other results, search/navigation controls |
| Bing | Individual result, shopping tile or ad unit | Other results, search/navigation controls |
| DuckDuckGo | Individual result or ad unit | Other results, search/navigation controls |
| Gmail | Individual opened email | Other emails in the thread, mailbox controls, drafts, composers |
| Outlook | Individual opened email | Other emails in the thread, mailbox controls, drafts, composers |

This table defines intended ownership, not universal coverage of every layout. Supported selectors and verification evidence are recorded below. Unknown layouts must retain conservative fragment filtering rather than invent a larger deletion boundary. Do not escalate from a child reply's decision to its whole thread.

## Layout evidence collected during implementation

A clean, unauthenticated Chromium session was used. No challenges were solved and no login/account actions were taken. Only bounded structural markers were inspected; no page dumps or private messages were retained.

- YouTube search and Amazon search exposed real video/product cards.
- TikTok exposed explore-card structure behind its login UI; this is not authenticated feed verification.
- Twitch directory, Pinterest ideas, Threads' public landing feed, AliExpress's public home and Bing search rendered. Each adapter still needs item-specific assertions; a loaded page alone proves nothing about boundaries.
- GroupMe, X, Facebook, Instagram, LinkedIn, Discord, WhatsApp, Telegram, Slack, Gmail and Outlook did not expose authenticated item layouts.
- Reddit, eBay, Etsy, Walmart, Google Search and DuckDuckGo returned challenges or access-error pages. Do not call these live-verified.
- Bluesky initially exposed the profile shell, not loaded posts.

### Source references

These are evidence for selectors and relationships, not guarantees of current site behavior. Source-backed synthetic fixtures must be distinguished from live-observed layouts. No third-party scripts are executed or bundled into the extension.

- GroupMe public deployed frontend: `https://web.groupme.com/assets/js/App-CB1-MNKu.js`. Message renderers expose `[data-message][data-message-id]`, `[data-message-sender-type]` and a separate `[data-scrolling-messages-div][role=log]`. The text renderer has explicit contiguous-message grouping, so its first message's avatar/name may be shared. Public bundle inspection is not a signed-in browser test.
- Social Stream Ninja DOM readers, pinned at `f7e4c50cfad9576eb51869a41629855d6ac7229e`: https://github.com/steveseguin/social_stream/tree/f7e4c50cfad9576eb51869a41629855d6ac7229e/sources . Discord, Slack, WhatsApp, Telegram and Threads supply useful item markers. Discord/Slack readers explicitly look at preceding rows for missing sender identity.
- Gmail.js, pinned at `2dd9644a7f0101714ac847320c162a721032ded4`: https://github.com/KartikTalwar/gmail.js/blob/2dd9644a7f0101714ac847320c162a721032ded4/src/gmail.js . Individual opened emails use `div.adn`; inbox `tr.zA` rows may summarize threads.
- Outlook DOM reference: https://github.com/simonpiekarz/airminal-extension/blob/e0cae789f918f3079e02f6b110542efc67b435f2/platforms/outlook.js . Treat conversation IDs as collections, not individual email IDs; require an actual message body under a message-specific root.
- eBay current/legacy result cards: https://github.com/thunderbit-operations/ebay-scraper and https://github.com/triposat/liveproxies-eBay/blob/main/ebay_search_scraper.py . New results use `li.s-card[data-listingid]`; legacy results use `li.s-item`.
- Etsy observed card markup: https://stackoverflow.com/questions/66678448/etsy-product-scraper-pulling-off-one-row-of-data . This is historical source evidence, not live-current verification.
- Walmart result markup: https://github.com/seleniumbase/SeleniumBase/blob/master/examples/cdp_mode/raw_walmart.py . Only its item/heading markers are relevant; do not use its challenge-handling routines.
- Search-result boundaries: https://github.com/quenhus/uBlock-Origin-dev-filter and https://github.com/spider-rs/web-scraping-examples/blob/main/search/duckduckgo-scraper.ts . Use structure, not these projects' domain blocking rules.
- The established distinction between selecting evidence and an enclosing target is also documented by uBlock: https://github.com/gorhill/uBlock/wiki/Procedural-cosmetic-filters#subjectupwardarg . This implementation does not import uBlock filters or use unrestricted ancestor climbing.

## Implemented-layout matrix

Desktop web only. **Every enabled row below has a controlled, synthetic browser fixture and real extension → FastAPI → Jev integration check. None is a blanket live-removal certification.** The browser checks exercise 44 enabled layout shapes across 42 rules; they do not exhaust every selector alternative, locale or experiment.

The later public survey found accepted item boundaries for YouTube search, Threads, Bluesky and Bing. A separate YouTube watch-page inspection confirmed player/metadata regions without overlap with comments or recommendations. Amazon and TikTok supplied structural observations earlier, but did not expose accepted scopes in the final unauthenticated survey. All other rows remain source/fixture-tested or provisional, not live-verified.

| Adapter | Implemented shapes | Important gaps / verification limits |
| --- | --- | --- |
| YouTube | Video-card renderers, including compact/hero search watch cards; reel player; comment renderer; watch player plus `ytd-watch-metadata` (legacy above-the-fold fallback) | Search/watch boundaries observed, including the public `black ops` search watch-card panel. Other layouts remain fixture-tested. No pixels/audio analysis. |
| Amazon | Search result card; individual review; named product-detail columns/description | Search markup observed earlier; detail scope and alternate storefronts unverified. |
| X | `article[data-testid=tweet]` | Authentication blocked live inspection; not an arbitrary timeline wrapper. |
| GroupMe | `[data-message][data-message-id]`, including its profile/content/actions | Deployed renderer source inspected; contiguous sender identity tested; signed-in layouts unverified. |
| Reddit | Shreddit posts/comments and old-Reddit `.thing` units | Challenge blocked live inspection; nested reply preservation fixture-tested. |
| Facebook | Individual `role=article` units | Other comment/Reel layouts unverified; no generic feed deletion. |
| Instagram | Individual `article` presentations | Standalone comments/Reels not explicitly mapped. |
| TikTok | Explore/profile video cards and recommendation-list player units | Explore markup observed earlier; other feeds/comments unverified. |
| Twitch | Preview-card articles; chat messages; named player/channel-info regions | Directory category cards are not stream cards; signed-in/player variants unverified. |
| Pinterest (disabled) | Pin wrappers and closeup presentation; module retained but not registered | Generic filtering only for now. Public ideas page did not verify these specific units. |
| LinkedIn | Feed updates and comment-item wrappers | Authenticated variants unverified. |
| Threads | Individual post containers associated with post links | Public post boundaries observed; authenticated/reply variants unverified. |
| Bluesky | Feed-item and post-thread-item wrappers | Public profile feed boundaries observed; thread variants unverified. |
| eBay | Current/legacy result cards; named listing gallery/title/buybox regions | Access challenge; complete detail-page coverage, including external descriptions, is not verified. |
| Etsy | Listing cards | Detail pages are not mapped: the cart panel alone is not the whole product. |
| Walmart | Search product-item cards | Detail pages and other storefront variants not mapped. |
| AliExpress | Item-link/search cards | Detail pages not mapped; public home did not verify result cards. |
| Discord | Individual chat-message rows | Authenticated variants unverified; shared sender identity fixture-tested. |
| WhatsApp | Message-in/out bubbles | Authenticated variants unverified. |
| Telegram | Web A messages and Web K bubbles | Authenticated variants unverified; Web A shared identity fixture-tested. |
| Slack | Individual message containers | Authenticated variants unverified; shared identity/thread protections fixture-tested. |
| Google Search | Heading-bearing result wrappers | Challenge blocked inspection; shopping and alternative ad layouts not comprehensively mapped. |
| Bing | Organic results and `b_ad` list items | Organic-result boundaries observed; other ads/shopping layouts unverified. |
| DuckDuckGo | Result articles and legacy result wrappers | Access blocked live inspection; alternative ad layouts unverified. |
| Gmail | Opened `div.adn` emails containing `.a3s` | Source-backed only; inbox/thread-summary rows and composers protected. |
| Outlook | Message-specific `data-item-id` wrappers containing a message body | Source-backed/provisional; conversation wrappers are not deletion units. |

## Verification and safety limits

- `bun run build && bun run test:adapters`: 25 enabled site fixtures through the real built extension/backend/provider, including a title-only Black Ops 7 video and a badge-only X ad; one kept neighbor and one logical removal per fixture. The compact/hero search watch-card cases verify title and thumbnail removal together while preserving a neighboring video and View All. The additional watch-page case verifies a paused native player, disjoint removal, preserved comments/recommendations and one logical count. Provider failures fail the test; responses are not substituted. Browser-only hostname mapping points explicitly synthetic pages at an actual local HTTPS fixture server.
- The structural browser tests verify Pinterest falls back to generic discovery and cover all 42 enabled rules plus both search watch-card variants, private fields, editable drafts, owned action controls, shared sender identity, independent replies, deceptive hostname rejection and text-only link identity changes. They also cover repeated part IDs inside protected regions and synchronous custom-element mutations between deletions.
- `bun run observe:adapters` is a **read-only coverage survey**, not a passing support test. It reports loaded-but-unmatched, redirected and inaccessible layouts separately in the ignored `artifacts/adapters-live.json`; it samples at most 30 visible matches per rule. It performs no inference or removals and uses no signed-in profile. A missing match is not silently counted as support.
- Shared identity is kept while a following headerless message can depend on it. Uncertain/empty shared header shells may remain. The implementation does not detach and rebuild surviving conversations.
- Whole-root items use the existing guarded motion renderer. Multi-region items deliberately skip animation and use a synchronous guarded commit. If a site's custom-element callback changes a later region, deletion stops; a partial operation is not counted or reported as a complete removal. There is no unsafe rollback that resurrects stale DOM.
- Debug outlines cover removable elements, not their shared ancestors. Bare text nodes have no outline. Closed shadow roots and cross-origin embedded documents remain opaque.
- Node membership, raw source/link identity and site IDs produce local revision tokens only. The existing candidate payload is unchanged. New independent content and ownership changes are checked before effects; the extension still provides reactive, best-effort filtering, not initial-exposure prevention.

Signed-in live tests and additional layout captures are follow-up work. The user approved finalizing this bounded implementation with these coverage limits rather than claiming universal support.

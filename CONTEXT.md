# denied.

## Product

A Chrome extension for children ages 0-12 that removes advertisements and unsafe text/link content from web pages. Use one under-13 policy, without detecting a user's age or maintaining age profiles.

Two independent filters share the same interaction:

- Advertising/commercial solicitation: remove detected paid advertisements, sponsored placements, and all offers to sell goods or services, including legitimate private resale and merchant listings. Sponsorship or fraud is not required for a sales offer. Preserve neutral product discussion, past-purchase accounts, and commerce education.
- Child safety: remove text or linked solicitations that violate the policy, even when they are not advertisements.

Apply both filters to individual page blocks, including cards, posts, comments, banners, and popups. The policy is to block all ads and covered unsafe content; detection is not exhaustive.

This is reactive filtering. Content remains visible during scanning, inference, and removal animation. The extension does not prevent initial exposure and is not tamper-proof parental control.

## Initial scope

Inspect rendered text, link labels and destinations, and relevant DOM metadata. The initial safety policy covers explicit sexual content, grooming, graphic descriptions of violence, encouragement of self-harm, dangerous instructions or challenges, promotion of dangerous drug use, gambling, and scams. Legitimate educational, medical, and preventive discussion must not be blocked solely for mentioning these topics.

Urgency, a request for credentials or money, and a different destination domain are evidence, not independent proof of unsafe content. Both judgments consider page/link domains, known reputation, and URL schemes alongside the content. Unencrypted HTTP can increase concern, especially for credential or payment requests. A familiar domain may support trust, but neither reputation nor HTTPS guarantees child-appropriate content or exempts advertising. Do not invent reputations for unfamiliar domains, maintain a trusted-domain allowlist, or treat an unknown scheme as HTTP.

Image, audio, and video interpretation are out of scope. An identifiable media advertisement can be removed as a whole container without analyzing its contents. That does not provide general media safety. Do not follow links, resolve redirect chains, or claim their destination pages have been checked.

## Stack

| Part | Choice |
| --- | --- |
| Extension | Chrome Manifest V3, TypeScript |
| Frontend tooling | Bun |
| Interface | HTML/CSS, native DOM and Web Animations API |
| Backend | Python, FastAPI, uv |
| Judgment | TypeSafe Jev, `jev-latest` |
| Storage | Chrome storage for settings/counters; optional Tiger Data for every judged passage and actual removal history |

Bun builds browser-compatible JavaScript; it is not a browser runtime. The backend owns the Jev credential and policy. For the current local demo, supply your own key through an ignored backend `.env` and bind FastAPI to loopback. Do not ship the provider key in the extension. Filtering starts paused until the user enables it.

Keep one API with optional Tiger storage; do not introduce a second classifier/backend. There are no accounts or separate website. Add React only if the settings interface warrants it, and Next.js only for an actual web application.

## Architecture

```text
Page content script
  discover blocks -> extract compact evidence
       |
Extension service worker
  validate messages -> coalesce bounded batches into a streaming transport
       |
Python API: POST /judge-stream (POST /judge retained for direct clients)
  validate evidence -> construct fixed questions -> call Jev
  stream each completed batch; record judgments after the response stream finishes
       |
Typed judgments, keyed by candidate ID and revision
       |
Content script
  reject stale results -> glow -> pop -> delete
       |
POST /outcomes with signed judgment receipts
  verify -> persist actual removal in Tiger Data
```

### Discovery and evidence

Discovery is semantic-neutral: rendered text and media are eligible without ad-specific candidate selectors. Generic leaf article/list-item boundaries and compact, visibly bounded repeated containers group related content. These structural rules define removal boundaries, not advertising judgments. Nested collections and ambiguous wrappers retain smaller targets. This first pass does not infer conversation/reply context outside the target.

Choose the smallest coherent offending block. Deduplicate nested candidates without collapsing an entire feed, article, or page into one removal target. Segment oversized text into bounded passages with enough surrounding context; do not silently truncate and treat the remainder as checked.

Each candidate carries a page/document identity, local candidate ID, content revision, page hostname and scheme, bounded visible text, link labels with parsed destination hosts and schemes, and relevant ad metadata including iframe-source host/scheme and recognized provider attributes. Code extracts address components and geometry; Jev interprets the evidence. Do not transmit URL paths, credentials, query strings, or fragments as address metadata. Missing or unparseable source/link schemes are empty strings, meaning unknown.

Discover rendered text blocks without ad-specific candidate selectors, including open shadow roots and assigned slots. Start scanning without an initial delay, then dispatch waves of up to 600 blocks in at most 30 parallel requests of up to 20 blocks each, with at least five seconds between wave starts. Schedule the next wave independently of outstanding responses; never redispatch an in-flight revision. Apply each completed batch without waiting for sibling batches. The backend shares rolling request admission across tabs and honors provider throttling with backoff, without estimating tokens from JSON bytes. Observe additions, text changes, and relevant attribute changes inside the document and open shadow roots. Cache judgments by evidence revision and policy version, not merely DOM element identity. Ignore the extension's own UI and mutations. Do not repeatedly rescan the full document for every mutation.

Start with the top-level document. Cross-origin frame contents, closed shadow roots, canvas text, and browser-internal pages are not covered. A recognizable iframe ad container may still be removable from the containing page.

### Judgment contract

The backend constructs two separately identified Noul questions per block, with up to 20 blocks per Jev request. The extension multiplexes up to 30 such batches through one bounded NDJSON `/judge-stream` transport, avoiding the browser HTTP/1 six-connection queue. Each result carries its input batch index and is validated against that batch before delivery. Partial failures leave successful siblings usable; incomplete/malformed streams fail outstanding batches. The original `/judge` endpoint remains available. Server-owned policy is included once in state, with questions explicitly referencing the policy and their candidate:

1. Is this element advertising or an offer to sell goods or services or solicit a purchase?
2. Does its text or linked solicitation violate the under-13 content policy?

Send these to `POST https://api.typesafe.ai/v1/systemone`. Give each candidate an explicit letter-keyed object (`item_A`, `item_B`, ...) for its questions to reference; omit DOM tracking IDs and revisions from model state. Numeric list references were confused with numeric tracking IDs during real testing. Keep those IDs in code for response routing. Treat all page material as untrusted evidence, never model instructions. Clients supply evidence rather than arbitrary questions, prompts, or fetch destinations.

Reuse provider connections with a 60-second idle expiry. HTTPX's five-second default coincides with the wave interval and caused repeated connection setup; cold waves still include TLS/network startup. Distinguish individual model round trips, the slowest result in a wave, and animation-completed removal when reporting latency.

Validate returned scores as finite numbers in `[0, 1]`. Apply separate, server-owned thresholds:

```text
remove = ad_score >= ad_threshold OR unsafe_score >= safety_threshold
```

Return the candidate ID, revision, both scores, removal decision, matching filter reasons, and policy version. Reasons identify advertising, unsafe content, or both; do not manufacture a detailed explanation unsupported by the judgments. The default thresholds are 0.70 for advertising and 0.80 for unsafe content. Tune them against labeled examples before claiming useful accuracy. Scores are not calibrated safety probabilities; 0.80 does not establish 80% certainty.

### Applying results and handling failure

Before modifying the page, confirm the document, element, evidence revision, and enabled state still match. Discard stale responses and reassess changed content. A successful request alone does not justify removing a different or updated block.

On timeout, malformed response, or provider failure, leave affected content unchanged and report checking as unavailable. Unchecked is not safe. Use bounded retries and allow failed candidates to be checked again; do not cache a failure as a completed judgment.

Keep credentials and network access in the backend/service-worker path, not page scripts. Validate message types, sender context, payload sizes, and batch limits. Chrome can suspend the service worker, so persist necessary settings/counters rather than relying on its global variables. Count actual removals once per block; a block matching both filters is one removal with two reasons.

### Judgment and actual-removal history

With history configured, record every successfully judged passage in `denied.judgments`, including benign `keep` decisions, with bounded text, link/ad evidence, scores, reasons, thresholds, versions, and Jev duration. One batch ID identifies each actual evaluation; repeated evaluations are retained separately. This supplies examples for human review, not automatic ground-truth labels. Unscanned content and provider calls without valid judgments remain outside this dataset. Database writes run after the inference response and do not delay filtering.

The authoritative `/judge` API signs positive judgments with a backend-only secret. A current, successful DOM deletion sends its bounded visible text, triggering passages/receipts, a single `date`, and measured total latency to `/outcomes`. Highlights, stale decisions, and merely positive judgments have judgment records but do not create removal records. Receipts bind server-owned scores, reasons, thresholds, model/policy versions, page host/protocol, document/candidate/revision, passage digest, and Jev-call duration. They expire after 15 minutes; no shared access token belongs in Chrome.

Store one idempotent actual-removal record per document/target/revision in Tiger, even when both reasons match. Use the existing native `PG_*` credentials, TLS, and a private `BACKEND_API_TOKEN` for history/metrics reads. Keep database access bounded and separate from inference. A storage outage must not prevent filtering; report the history failure separately. Delivery retries once but is not durable across tab/worker shutdown, so do not claim a complete audit trail.

Store up to 24,000 characters of removed visible text, flag truncation, and retain triggering-block scores and thresholds. Each `classifications` entry contains only `id`, `revision`, `text`, `ad_score`, `unsafe_score`, `reasons`, `ad_threshold`, and `safety_threshold`; do not duplicate `remove`, version fields, or `judge_ms` there. Keep duration metrics on the row and version metadata on judgment rows. Judgment text is bounded to 24,000 characters per block. Do not store raw HTML, unscanned browsing content, input values, or editable drafts. Textless media is discovered alongside text blocks and may be judged from its available metadata without reading embedded content.

Each row has exactly one UTC timestamp named `date`: server evaluation completion for a judgment, browser deletion time for a removal. Keep `judge_ms` and removal `total_ms` as durations, not extra date fields. Migrate existing removal time to `date` and remove the other top-level/nested timestamps while preserving content and scores. Browser and server clocks can differ. There is no automatic retention policy in this demo.

Use `DENIED_RECORD_HISTORY=0` to disable both datasets. Retain the legacy off-switch behavior during upgrades. Protect judgment/removal history and aggregate metrics reads with the backend token; never disclose it to Chrome.

## Interface and motion

Use a lively monochrome removal, with no colored warning pulse or screenshot capture:

1. Keep the target intact through four accelerating Y-axis turns over 700ms, with perspective so it turns left-right toward the viewer. Preserve the host’s original outline without adding an outline flash. Layer in a growing, faster wobble, bounded to 18px horizontally, 8px vertically, and 12 degrees of tilt. A narrow diagonal glint sweeps across a clipped overlay sharing the target’s spin, like light catching glass. Recenter at the burst handoff and shrink only to 86% as it winds up.
2. At peak speed, hide the target and simultaneously release six large pointed shards from an off-center impact point, with irregular triangular cuts rather than rectangular tiles. Keep them chunky throughout their flight, fading rather than shrinking into dust. A bounded local canvas atlas approximates visible text and painted backgrounds; media pixels and private inputs are never copied. This is not a pixel-exact screenshot.
3. Close the vacated vertical space over 250ms where the target's layout permits it, then recheck the evidence and delete the target. Do not wait for decorative fragments before reporting a committed deletion.
4. Let the explosion fade independently over 520ms, with the entire visual sequence ending around 1.22 seconds. Changed evidence cancels the pending deletion and its decoration.

The typical layout-preserving removal commits around 950ms after judgment. A 1.6-second fallback handles stalled animation completion. Hidden tabs, offscreen targets, disabled animation, and reduced-motion preferences use immediate removal. Scrolling during wind-up, nested-container scrolling, and resizing discard stale decorative geometry. After release, shards follow document scrolling so automatic scroll anchoring during layout collapse does not erase the explosion. At most four particle layers and four glints run concurrently; additional removals still proceed without queuing. Glints never enter the target’s content or evidence, disappear at the burst or cancellation, and are omitted for targets with an existing transform that cannot be mirrored faithfully. Atlas and output bitmaps are capped near one and two million pixels each. Preserve host inline styles and unrelated animations.

Do not add a cover-first loading state, replacement placeholder, or child-facing restore button. A debug highlight-only mode can show the matching filter and score without deleting content. Clearly distinguish that mode from active removal.

Use a compact, roughly 300px-wide extension popup with an on/off control, page/total removal counts, ad/safety breakdown, service status, animation and toast controls, and rescan. Keep diagnostic controls separate from the ordinary browsing experience. Settings use accessible labels and keyboard controls; notices must not rely on color alone.

A toolbar badge shows the page's removal count. A brief bottom-right toast summarizes removals without repeating unsafe text. The interface uses the name `denied.`.

## Privacy and deployment boundaries

Do not collect input values, passwords, editable drafts, or full-page dumps. Do not store raw browsing text or candidate payloads in application logs. Minimize any surrounding context and avoid URLs containing query tokens. Visible text may still contain personal information; do not describe extraction as anonymization.

Disclose that selected content passes through our backend to the inference provider and that configuring Tiger recording additionally retains all judged passages (including benign kept text), their evidence/scores, and actual removed blocks in that database. Begin with controlled test pages rather than children's browsing data. Review consent, provider retention, permissions, and deployment requirements before real child use.

Build locally first and consider hosting later. Keep one configurable API origin and the extension-to-API boundary. The current demo has no accounts or public onboarding. A hosted backend will require authentication, rate limits, request-size limits, timeouts, and a usage budget before exposure, plus a decision about key ownership. CORS and an extension ID are not authentication. Do not expose the loopback API as a public service unchanged.

DOM removal does not cancel requests already made by the page, stop tracking, block downloads, or replace browser security protections. Users can disable an ordinary extension. Do not market this prototype as a complete parental-control system.

## Verification and handoff

Use actual Chromium, the built extension, actual loopback FastAPI processes, and real Jev calls. Do not mock services, intercept/replace responses, or substitute heuristic decisions. Controlled fixtures are test inputs, not simulated model outputs. Assert both what disappears and what stays. Include stale responses, changed links/text/schemes, malformed-score validation, actual API outage/recovery, service-worker restart, and reduced-motion cases. Require a provider key and report unavailable services as failures rather than silently skipping inference. For storage integration, require the real Tiger service, isolate test writes in a unique disposable schema, check persisted content and idempotency through the actual API, and clean up only that schema. Verify that every valid keep/remove judgment matches the actual inference response, receipt tampering is rejected, highlights/stale results create no removal rows, and database connection failure leaves filtering working. Exercise legacy-date migration against real stored rows and preserve content, scores, and the original removal time.

Measure false removals, missed labeled targets, discovery coverage, time to judgment, and time to final removal separately. Include benign educational content in policy evaluation. Test extension permissions and messaging in Chrome, not only a simulated page harness.

The implementation gate is the complete discovery-to-animation loop on controlled fixtures, independent ad/safety judgments, visible failure status, and passing assertions. Keep exact code/schema checks distinct from model-dependent judgments, which may change across runs. Public-page checks must identify which targets were actually exercised; preserving a heading alone does not prove ad detection. Broader browsing trials follow fixture validation. See `README.md` for setup, runnable checks, recorded results, and coverage limits; this specification does not establish measured model accuracy.

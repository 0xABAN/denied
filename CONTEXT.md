# denied.

## Product

A Chrome extension for children ages 0-12 that removes advertisements and unsafe text/link content from web pages. Use one under-13 policy, without detecting a user's age or maintaining age profiles.

Two independent filters share the same interaction:

- Advertising: remove detected paid advertisements and sponsored placements, even when their content is child-safe.
- Child safety: remove text or linked solicitations that violate the policy, even when they are not advertisements.

Apply both filters to individual page blocks, including cards, posts, comments, banners, and popups. The policy is to block all ads and covered unsafe content; detection is not exhaustive.

This is reactive filtering. Content remains visible during scanning, inference, and removal animation. The extension does not prevent initial exposure and is not tamper-proof parental control.

## Initial scope

Inspect rendered text, link labels and destinations, and relevant DOM metadata. The initial safety policy covers explicit sexual content, grooming, graphic descriptions of violence, encouragement of self-harm, dangerous instructions or challenges, promotion of dangerous drug use, gambling, and scams. Legitimate educational, medical, and preventive discussion must not be blocked solely for mentioning these topics.

Urgency, a request for credentials or money, and a different destination domain are evidence, not independent proof of unsafe content. Evaluate them in context. Do not infer a site's trustworthiness from its hostname alone.

Image, audio, and video interpretation are out of scope. An identifiable media advertisement can be removed as a whole container without analyzing its contents. That does not provide general media safety. Do not follow links, resolve redirect chains, or claim their destination pages have been checked.

## Stack

| Part | Choice |
| --- | --- |
| Extension | Chrome Manifest V3, TypeScript |
| Frontend tooling | Bun |
| Interface | HTML/CSS, native DOM and Web Animations API |
| Backend | Python, FastAPI, uv |
| Judgment | TypeSafe Jev, `jev-latest` |
| Storage | Tiger Cloud managed PostgreSQL for privacy-safe decision telemetry; Chrome extension storage for settings and necessary counters |

Bun builds browser-compatible JavaScript; it is not a browser runtime. The backend owns the Jev credential and policy. Do not ship the provider key in the extension.

Start without React, Next.js, accounts, or a separate website. Tiger Cloud is the single server-side database for timestamped, privacy-safe decision telemetry; do not add another database. Add React only if the settings interface warrants it, and Next.js only for an actual web application.

## Architecture

```text
Page content script
  discover blocks -> extract compact evidence
       |
Extension service worker
  validate messages -> forward bounded requests
       |
Python API: POST /judge
  validate evidence -> construct fixed questions -> call Jev
       |
Typed judgments, keyed by candidate ID and revision
       |
Content script
  reject stale results -> glow -> pop -> delete
```

### Discovery and evidence

Keep two discovery paths: ad heuristics and visible text-block discovery. Ad heuristics can use sponsorship labels, element attributes, known ad hosts, and container shape. Safety discovery must also find ordinary paragraphs and comments without ad-like markup.

Choose the smallest coherent offending block. Deduplicate nested candidates without collapsing an entire feed, article, or page into one removal target. Segment oversized text into bounded passages with enough surrounding context; do not silently truncate and treat the remainder as checked.

Each candidate carries a page/document identity, local candidate ID, content revision, page hostname, bounded visible text, link labels with parsed destination hosts, and relevant ad metadata. Code extracts URLs and geometry; Jev interprets the evidence.

Use debounced, bounded batches. Observe additions, text changes, and relevant attribute changes such as link destinations. Cache judgments by evidence revision and policy version, not merely DOM element identity. Ignore the extension's own UI and mutations. Do not repeatedly rescan the full document for every mutation.

Start with the top-level document. Cross-origin frame contents, closed shadow roots, canvas text, and browser-internal pages are not covered. A recognizable iframe ad container may still be removable from the containing page.

### Judgment contract

The backend constructs two independent Noul questions per candidate in a batch:

1. Is this element a paid advertisement or sponsored placement?
2. Does its text or linked solicitation violate the under-13 content policy?

Send these to `POST https://api.typesafe.ai/v1/systemone`. Treat all page material as untrusted evidence, never model instructions. Clients supply evidence rather than arbitrary questions, prompts, or fetch destinations.

Validate returned scores as finite numbers in `[0, 1]`. Apply separate, server-owned thresholds:

```text
remove = ad_score >= ad_threshold OR unsafe_score >= safety_threshold
```

Return the candidate ID, revision, both scores, removal decision, matching filter reasons, and policy version. Reasons identify advertising, unsafe content, or both; do not manufacture a detailed explanation unsupported by the judgments. Tune thresholds against labeled examples before claiming useful accuracy. Scores are not certified safety probabilities.

### Applying results and handling failure

Before modifying the page, confirm the document, element, evidence revision, and enabled state still match. Discard stale responses and reassess changed content. A successful request alone does not justify removing a different or updated block.

On timeout, malformed response, or provider failure, leave affected content unchanged and report checking as unavailable. Unchecked is not safe. Use bounded retries and allow failed candidates to be checked again; do not cache a failure as a completed judgment.

Keep credentials and network access in the backend/service-worker path, not page scripts. Validate message types, sender context, payload sizes, and batch limits. Chrome can suspend the service worker, so persist necessary settings/counters rather than relying on its global variables. Count actual removals once per block; a block matching both filters is one removal with two reasons.

## Interface and motion

Preserve this sequence after a removal decision:

1. Add a 3px rose-red outline to the visible element.
2. Pulse an expanding glow twice, 450ms per pulse.
3. Over 320ms, enlarge to 1.08 times its size, then shrink to zero while fading.
4. Delete the element from the DOM and let the page reflow.

The animation takes about 1.22 seconds after judgment. Schedule a 2.5-second fallback to remove the element if animation completion stalls. Hidden tabs, disabled animation, and reduced-motion preferences use immediate removal.

Do not add a cover-first loading state, replacement placeholder, or child-facing restore button. A debug highlight-only mode can show the matching filter and score without deleting content. Clearly distinguish that mode from active removal.

Use a compact, roughly 300px-wide extension popup with an on/off control, page/total removal counts, ad/safety breakdown, service status, animation and toast controls, and rescan. Keep diagnostic controls separate from the ordinary browsing experience. Settings use accessible labels and keyboard controls; notices must not rely on color alone.

A toolbar badge shows the page's removal count. A brief bottom-right toast summarizes removals without repeating unsafe text. The interface uses the name `denied.`.

## Privacy and deployment boundaries

Do not collect input values, passwords, editable drafts, or full-page dumps. Do not store raw browsing text or candidate payloads in application logs. Minimize any surrounding context and avoid URLs containing query tokens. Visible text may still contain personal information; do not describe extraction as anonymization.

Disclose that selected content passes through our backend to the inference provider. Begin with controlled test pages rather than children's browsing data. Review consent, provider retention, permissions, and deployment requirements before real child use.

A public backend requires authentication, rate limits, request-size limits, timeouts, and a usage budget before exposure. CORS and an extension ID are not authentication. Hosting and the prototype's access-provisioning mechanism remain implementation decisions; do not add an account system solely for the demo.

DOM removal does not cancel requests already made by the page, stop tracking, block downloads, or replace browser security protections. Users can disable an ordinary extension. Do not market this prototype as a complete parental-control system.

## Verification and handoff

Build controlled fixtures containing ads, unsafe text, legitimate lookalikes, and nested/dynamic content. Assert both what disappears and what stays. Include stale responses, changed links/text, malformed scores, API failure/retry, service-worker restart, and reduced-motion cases. Mocked UI tests and live Jev evaluations must be reported separately; a heuristic fallback is not evidence of model accuracy.

Measure false removals, missed labeled targets, discovery coverage, time to judgment, and time to final removal separately. Include benign educational content in policy evaluation. Test extension permissions and messaging in Chrome, not only a simulated page harness.

First implementation milestone: the complete discovery-to-animation loop on controlled fixtures with the real Python API, independent ad/safety judgments, visible failure status, and passing assertions. Broader browsing trials follow fixture validation. This document specifies the design; it does not claim an implementation or measured results.

# denied.

A local-first Chrome extension demo for under-13 text/link filtering and advertisement removal. Flagged blocks glow, pop, and disappear. The Python API supplies two independent Jev judgments; the browser owns discovery and animation.

Content remains visible while it is checked and animated. This is not prevention of initial exposure, a media moderator, or tamper-proof parental control. Read [CONTEXT.md](CONTEXT.md) for the policy and scope.

## Run locally

You need Bun, uv, Chrome, and your own TypeSafe API key.

```sh
# From the repository root:
bun install
bun run build
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set `TYPESAFE_API_KEY`. The file is ignored by Git. Do not paste your key into the extension or commit it.

```sh
cd backend
uv sync
uv run --env-file .env uvicorn denied.app:app --host 127.0.0.1 --port 8765
```

Then:

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this repository's `dist/` directory.
3. Open the `denied.` popup. The API status should be ready.
4. Enable filtering. It starts paused so installation alone does not send browsing text.
5. Reload already-open web pages after installing or rebuilding the extension.

The popup includes page/total counts, separate ad/safety counts, animation and toast switches, rescan, and a highlight-only diagnostic mode. A block matching both filters counts as one removal. Highlighting does not count as removal.

The API defaults to `http://127.0.0.1:8765`; change the origin under **Local API** if you use another local port. Provider credentials remain in the Python process. There is no frontend server to start.

## Verify

Service tests require `TYPESAFE_API_KEY` in `backend/.env` and make real Jev calls. There are no mocked endpoints, substituted responses, or heuristic fallbacks. Provider availability, model changes, and public-page changes can cause failures.

```sh
# Repository root:
bun run typecheck
bun run build
bunx playwright install chromium
bun run test:api
bun run test:extension
```

The API tests start actual loopback Uvicorn processes. They check labeled judgments, domain/protocol context, batch addressing, HTTP validation, missing/rejected credentials, and request budgets. Schema and request-construction checks run the real functions without provider spending.

The browser suite starts the API and loads the built extension in Chromium. It checks removals and benign-content preservation, private-input/URL exclusions, animation, changed text/links/protocols, stale responses, counters, and service-worker restart. An outage test stops the actual API, then restarts it. The whole browser run has a 60-provider-request budget, shared across restarts.

It also visits example.com, Python's about page, and W3Schools' HTML page without logging in or accepting consent dialogs. Public checks require real judgments and a preserved heading; the W3Schools check also requires visible provider ad slots before filtering and their removal afterward. These checks are not an exhaustive assessment of those sites. If ads do not load, that ad check fails rather than claiming coverage.

Screenshots and the latest browser report are saved under ignored `artifacts/`. Each browser invocation replaces `artifacts/real-results.json`; failure diagnostics may contain bounded public-page excerpts. To isolate one public-page check, explicitly skipping controlled-page checks:

```sh
bun run test:extension --public-only https://www.w3schools.com/html/
```

With the real API running and your key configured, opt into one live batch:

```sh
bun run test:live
# Another local API port:
DENIED_API_URL=http://127.0.0.1:8766 bun run test:live
```

This sends the eight synthetic examples in `tests/cases.json` to the real provider. It exits unsuccessfully if judgments differ from the labels. These are controlled inputs, not observations of live websites. Review individual mistakes before changing thresholds; eight examples are not a general safety benchmark.

### Recorded verification — 2026-09-19, policy 5

Typecheck and build passed. All seven API tests and all 13 browser checks passed. The browser run used 33 provider requests, removed 11 controlled-page targets, preserved the checked content on example.com and python.org, and removed three advertising targets on W3Schools. Public pages finished with no pending/deferred targets or reported errors in that run. This is a small integration sample, not a measured false-positive rate or a child-safety guarantee.

## Architecture

- `extension/src/scan.ts`: candidate boundaries and evidence extraction.
- `extension/src/content.ts`: bounded queue, revisions, retries, and stale-result rejection.
- `extension/src/effects.ts`: native glow/pop animation, notices, and diagnostic labels.
- `extension/src/background.ts`: fixed API bridge, trusted settings, and cumulative counters.
- `extension/src/popup.ts`: the compact HTML/CSS settings interface.
- `extension/src/contracts.ts`: shared types and boundary checks.
- `backend/denied/app.py`: FastAPI lifecycle, loopback request checks, deadlines, and request budget.
- `backend/denied/schemas.py`: bounded input and typed output.
- `backend/denied/judge.py`: policy, batched Jev call, and removal decisions.

Bun bundles TypeScript; Chrome runs the output. The backend uses FastAPI, HTTPX, and Pydantic. There is no React, Next.js, database, or account system.

## Limits and privacy

- Removal requires `ad_score >= 0.70` **or** `unsafe_score >= 0.80` by default. These are uncalibrated model scores, not verified 70%/80% certainty. Higher thresholds trade fewer false removals for more missed targets. Set `DENIED_AD_THRESHOLD` and `DENIED_SAFETY_THRESHOLD` in `backend/.env` and restart the API; `/health` reports the active values.
- Both questions receive page, link, and iframe-source hostnames and URL schemes. Domain reputation and HTTP/HTTPS are context, not allowlists or automatic decisions. A familiar domain or HTTPS does not guarantee child-appropriate content or exempt advertisements; unknown schemes remain unknown.
- A request contains at most 20 passages, each at most 1,000 characters. Up to 24,000 characters and eight visible links are inspected per target. Longer/overlinked targets are reported as partially unchecked; observed violations may still trigger removal.
- The browser retains at most 300 targets per page, evicting checked offscreen targets when needed. Deferred content is not safe by default, and scrolling back may require another judgment after eviction.
- Failed checks leave content unchanged and show an error. The browser retries once; rescan explicitly retries again. The API defaults to 200 provider calls per process, including failed calls. Restarting resets that demo budget.
- Selected visible text, link labels, hostnames/schemes, and bounded DOM metadata go through your local API to TypeSafe. Address extraction excludes URL paths, credentials, query strings, and fragments. Form values and editable drafts are excluded; visible text may still contain personal information. The application does not log candidate bodies or keep browsing text in storage.
- No general image, audio, video, canvas, shadow-root, or iframe-content interpretation. A recognizable iframe ad container can still be removed. Links are not followed and destination pages are not certified safe.
- Removing an element does not undo requests it already made, stop tracking, or block downloads. Reloading can restore removed content; the extension can be disabled.
- Test with controlled pages first. Review consent and provider data retention before use with actual children.

## Later hosting

Keep the same HTTP boundary, but do not expose this demo API publicly as-is. Hosting needs explicit authentication, budgets/rate limits, allowed hosts, HTTPS, and a decision about provider-key ownership and retention. A hosted origin also needs a matching extension host permission. The current host/origin checks are for loopback use, not a public access-control system.

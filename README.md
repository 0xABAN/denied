# denied.

A local-first Chrome extension demo for under-13 text/link filtering and advertisement removal. Flagged blocks glow, pop, and disappear. The Python API supplies two independent Jev judgments; the browser owns discovery and animation.

Content remains visible while it is checked and animated. This is not prevention of initial exposure, a media moderator, or tamper-proof parental control. Read [CONTEXT.md](CONTEXT.md) for the policy and scope.

## Run locally

You need Bun, uv, Chrome, and your own TypeSafe API key.

```sh
# From the repository root:
bun install
bun run build
cp -n backend/.env.example backend/.env
chmod 600 backend/.env
```

Edit `backend/.env` and set `TYPESAFE_API_KEY`. The file is ignored by Git. Do not paste your key into the extension or commit it.

```sh
cd backend
uv sync
uv run uvicorn denied.app:app --host 127.0.0.1 --port 8765
```

Then:

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this repository's `dist/` directory.
3. Open the `denied.` popup. The API status should be ready.
4. Enable filtering. It starts paused so installation alone does not send browsing text.
5. Reload already-open web pages after installing or rebuilding the extension.

The popup includes page/total counts, separate ad/safety counts, animation and toast switches, rescan, and a highlight-only diagnostic mode. A block matching both filters counts as one removal. Highlighting does not count as removal.

The API defaults to `http://127.0.0.1:8765`; change the origin under **Local API** if you use another local port. Provider credentials remain in the Python process. There is no frontend server to start.

## Optional Tiger Data judgment and removal history

Keep using the same `denied.app:app` API. Set Tiger's `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PGSSLMODE=require` in `backend/.env`. No separate database URL is needed. URL-only configurations can use `TIGER_DATABASE_URL` or `TIMESCALE_SERVICE_URL`; populated native `PG_*` settings take precedence.

Set a private `BACKEND_API_TOKEN` of at least 32 characters. Generate one locally with `uv run python -c 'import secrets; print(secrets.token_urlsafe(32))'` and save it only in the ignored environment file. Keep that file mode `0600`. The API loads it without overriding exported shell settings. Restart the backend after editing it.

On startup, the API creates two ordinary PostgreSQL tables, `denied.judgments` and `denied.removals`. Existing unrelated tables are untouched. Set `DENIED_RECORD_HISTORY=0` to disable both kinds of recording without disabling filtering. The old `DENIED_RECORD_REMOVALS` setting remains a fallback when the new setting is absent, so an existing off switch stays off.

**`denied.judgments` records every successfully judged passage**, including `keep` decisions. It stores bounded text, link/ad evidence, page hostname/protocol, both scores, decision/reasons, active thresholds, model/policy versions, and `judge_ms`. Document/target/candidate/revision IDs identify the case; a fresh `batch_id` identifies each actual Jev evaluation. Re-evaluations are separate judgments, not duplicates. This enables review of suspected false negatives, but a keep decision is not itself evidence of failure: human labels are still needed. Content the scanner never checked, and failed provider calls without a valid judgment, are not represented.

**`denied.removals` records actual browser deletions**, never just positive model decisions. Each row contains:

- Up to 24,000 characters of removed visible text and a truncation flag. No HTML or media capture; an opaque ad slot may have no text.
- Advertising, unsafe-content, or both classifications. Each entry contains only `id`, `revision`, `text`, `ad_score`, `unsafe_score`, `reasons`, `ad_threshold`, and `safety_threshold`.
- Page hostname and protocol, plus document/target/revision identifiers for deduplication. No full URL address metadata.
- One UTC `date` timestamp: when the browser removed the block. Judgment rows likewise have one `date`, marking when the server completed evaluation. The two clocks may differ.
- The server's Jev evaluation duration for the triggering batch, and the browser's measured detection-to-removal duration, including queuing and animation. Batch latency is shared by its passages, not a separate measurement for each passage.

Upgrading an existing removal table preserves `removed_at` as `date` and removes `detected_at`, `judged_at`, `recorded_at`, and nested judgment timestamps. Existing classification entries also have redundant `remove`, `policy_version`, `model_version`, and `judge_ms` keys removed. Text, scores, reasons, thresholds, and row-level duration fields are preserved. Migration runs transactionally on backend startup with recording enabled. After upgrading, restart the API, reload the extension, and refresh existing tabs for the new removal payload.

Judgment writes run after the inference response, using FastAPI's background tasks. `POST /outcomes` separately accepts short-lived signed receipts; callers cannot supply their own classifications or thresholds. Removal reports retry once and are idempotent. The shared backend token never enters the extension. Database failure does not prevent filtering: `/health` and the popup's API check report history errors, and failed removal delivery also appears in page status. **This is best-effort recording, not a durable outbox**; a failed write or process/tab/worker shutdown can lose records.

Protected read endpoints:

- `GET /judgments?decision=keep&limit=20`: inspect kept passages. Use `decision=remove` for flagged passages, or omit the filter for both. Flagged does not imply deleted: highlights and stale results still have judgments but no removal row.
- `GET /removals?limit=20`: actual removed blocks.
- `GET /metrics`: removal counts/median latencies, plus `total_judgments`, `kept`, and `flagged` passage counts. Passage counts are not block counts.

Read limits default to 20 and cap at 100. All three endpoints require an `X-Backend-Token` header matching `BACKEND_API_TOKEN`. Never put it in a URL or expose these endpoints publicly.

Kept and removed text may be sensitive. This demo has no automatic retention/deletion policy or review dashboard. Restrict database access and define consent, retention, and deletion before using real children's browsing data.

## Verify

Service tests require `TYPESAFE_API_KEY` in `backend/.env` and make real Jev calls. There are no mocked endpoints, substituted responses, or heuristic fallbacks. Provider availability, model changes, and public-page changes can cause failures.

```sh
# Repository root:
bun run typecheck
bun run build
bunx playwright install chromium
bun run test:api
bun run test:extension
# Also requires real Tiger credentials and BACKEND_API_TOKEN:
bun run test:telemetry
```

The API tests start actual loopback Uvicorn processes. They check labeled judgments, domain/protocol context, batch addressing, HTTP validation, and missing/rejected credentials. Schema and request-construction checks run the real functions without provider spending.

The browser suite starts the API and loads the built extension in Chromium. It checks removals and benign-content preservation, private-input/URL exclusions, animation, changed text/links/protocols, stale responses, counters, and service-worker restart. An outage test stops the actual API, then restarts it.

The ordinary API/browser suites disable recording. The Tiger suite uses actual Chromium, FastAPI, Jev, and Tiger Data, creates a unique `denied_test_*` schema, and removes only that schema afterward. It checks every kept/flagged passage against actual API responses, single-date records and migration of legacy dates, text/scores/timing, duplicate delivery, receipt tampering, authenticated reads, highlights and canceled removals, restart persistence, and an actual refused database connection followed by recovery. It never writes test data into the production `denied` schema.

The ordinary browser suite also visits example.com, Python's about page, and W3Schools' HTML page without logging in or accepting consent dialogs. Public checks require real judgments and a preserved heading; the W3Schools check also requires visible provider ad slots before filtering and their removal afterward. These checks are not an exhaustive assessment of those sites. If ads do not load, that ad check fails rather than claiming coverage.

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

### Recorded integration verification — policy 5

For the all-judgments/single-date change, typecheck/build, all seven real API tests, and all six real Tiger integration groups passed. Checks included retained passages, exact classification fields, migration from both legacy-date and single-date schemas without losing content or scores, idempotency, tampering, and database failure/recovery; the disposable schema was removed afterward. The earlier policy-5 baseline also passed all 14 browser checks, including example.com, Python's about page, and loaded advertising slots on W3Schools; that broader suite was not repeated for this storage change. The originally reported Reddit failure remains unconfirmed on the user's actual page. These are integration samples, not measured false-positive rates or child-safety guarantees.

## Architecture

- `extension/src/scan.ts`: candidate boundaries and evidence extraction.
- `extension/src/content.ts`: bounded queue, revisions, retries, and stale-result rejection.
- `extension/src/effects.ts`: native glow/pop animation, notices, and diagnostic labels.
- `extension/src/background.ts`: fixed API bridge, trusted settings, and cumulative counters.
- `extension/src/popup.ts`: the compact HTML/CSS settings interface.
- `extension/src/contracts.ts`: shared types and boundary checks.
- `backend/denied/app.py`: FastAPI lifecycle, loopback request checks, and deadlines.
- `backend/denied/schemas.py`: bounded input and typed output.
- `backend/denied/judge.py`: policy, batched Jev call, and removal decisions.
- `backend/denied/telemetry.py` and `backend/schema.sql`: signed removal receipts, optional Tiger storage, and protected history/metrics reads.

Bun bundles TypeScript; Chrome runs the output. The backend uses FastAPI, HTTPX, Pydantic, and Psycopg. There is no React, Next.js, second backend, or account system.

## Limits and privacy

- Removal requires `ad_score >= 0.70` **or** `unsafe_score >= 0.80` by default. These are uncalibrated model scores, not verified 70%/80% certainty. Higher thresholds trade fewer false removals for more missed targets. Set `DENIED_AD_THRESHOLD` and `DENIED_SAFETY_THRESHOLD` in `backend/.env` and restart the API; `/health` reports the active values.
- Both questions receive page, link, and iframe-source hostnames and URL schemes. Domain reputation and HTTP/HTTPS are context, not allowlists or automatic decisions. A familiar domain or HTTPS does not guarantee child-appropriate content or exempt advertisements; unknown schemes remain unknown.
- A request contains at most 20 passages, each at most 1,000 characters. Up to 24,000 characters and eight visible links are inspected per target. Longer/overlinked targets are reported as partially unchecked; observed violations may still trigger removal.
- The browser retains at most 300 targets per page, evicting checked offscreen targets when needed. Deferred content is not safe by default, and scrolling back may require another judgment after eviction.
- Failed checks leave content unchanged and show an error. The browser retries once; rescan explicitly retries again. The local API bounds concurrency, body sizes, and deadlines but has no provider-spend cap; real calls may incur charges.
- Selected visible text, link labels, hostnames/schemes, and bounded DOM metadata go through your local API to TypeSafe. Address extraction excludes URL paths, credentials, query strings, and fragments. Form values and editable drafts are excluded; visible text may still contain personal information. The application does not write candidate bodies to runtime logs. When Tiger recording is configured, it retains **all judged passages, including benign kept text**, their evidence/scores, and actual removed blocks. Input values, editable drafts, and unscanned browsing content remain excluded. Visible text itself can include a written-out URL; address-field exclusions are not text anonymization.
- No general image, audio, video, canvas, shadow-root, or iframe-content interpretation. A recognizable iframe ad container can still be removed. Links are not followed and destination pages are not certified safe.
- Removing an element does not undo requests it already made, stop tracking, or block downloads. Reloading can restore removed content; the extension can be disabled.
- Test with controlled pages first. Review consent and provider data retention before use with actual children.

## Later hosting

Keep the same HTTP boundary, but do not expose this demo API publicly as-is. Hosting needs explicit authentication, budgets/rate limits, allowed hosts, HTTPS, and a decision about provider-key ownership and retention. A hosted origin also needs a matching extension host permission. The current host/origin checks are for loopback use, not a public access-control system.

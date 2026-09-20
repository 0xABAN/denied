# Live latency baseline

These measurements use the actual scanner, current three-question policy, FastAPI,
and real Jev calls. There are no substituted judgments. Public pages run in isolated
Chromium profiles; history persistence is disabled. No account data or raw page text
is written to the timing reports. Results are observations, not latency guarantees.

## Settled-page snapshot comparison

`bun src/extension/tests/sites-latency.real.ts youtube speedtest reddit wikipedia`

The snapshot harness waits three seconds for page hydration, then times discovery,
evidence extraction, and streamed judgments for every discovered block. Navigation,
that stabilization wait, extension messaging, animation, and history persistence
are excluded. There is no artificial inference-wave delay. Each configuration uses
three real calls per workload, not cached judgments. The 20-block configuration runs
before the 10-block configuration, so connection warmth/order confound comparisons.

| Public page | Blocks | Scan + evidence | 20/block request: all judgments | 10/block request: all judgments |
| --- | ---: | ---: | ---: | ---: |
| YouTube search: black ops 7 | 63 (20 video cards present) | 69ms | 320–775ms | 236–514ms |
| Speedtest homepage | 49 | 6ms | 264–303ms | 230–310ms |
| Wikipedia: Solar System | 1,294 | 241ms | 1,036–6,077ms | 1,953–2,325ms |

Add scan/extraction time to judgment time for snapshot-to-all completion. Thus even
YouTube's fastest 10-block trial was approximately 305ms before extension overhead.
Wikipedia was rerun separately with all 1,294 blocks after the initial harness cap
skipped inference. The benchmark now reports oversized workloads explicitly rather
than truncating them. Reddit returned a humanity challenge: its initial five-block
challenge-page timings are invalid as Reddit-content results and must be excluded.
The harness now rejects that challenge title before inference.

Source reports: `artifacts/sites-latency-real.json` and
`artifacts/sites-latency-wikipedia-1789860326590.json` (ignored local artifacts).

## Actual installed extension on live YouTube

`BENCH_ROUNDS=1 bun src/extension/tests/youtube-extension-latency.real.ts`

The production extension runs with animation/toasts disabled in an isolated profile.
A local observer forwards streaming chunks immediately; it does not hold fast results
until the entire response finishes. CPU profiling is enabled and adds measurement
overhead. Completion requires no pending targets, active waves, or queued roots, and
one second without another result. The one-second observation window is not included
in first-dispatch-to-last-result timing. A timeout does not establish completion.

Two corrected sequential runs reached that state with zero API errors:

| Run | Submitted blocks | Provider batches | First result | Last result | Remaining checked / pending / deferred |
| --- | ---: | ---: | ---: | ---: | --- |
| Completion baseline | 168 | 14 | 397ms | 4,857ms | 17 / 0 / 0 |
| Evidence-duplication profile | 173 | 17 | 617ms | 4,820ms | 20 / 0 / 0 |

The duplication run had 173 distinct document/candidate/revision tuples, but only
115 distinct complete evidence payload hashes. That is 58 repeated payloads (34%).
This does not prove they were erroneous retries: different DOM items/revisions can
carry identical evidence. It does identify page-scoped reuse/coalescing as a concrete
optimization opportunity. Such reuse must retain target freshness and valid telemetry
receipts; copying signed results to another identity is not automatically safe.

The largest named extension CPU consumers were rendered-tree traversal (`children`,
`visit`) and visibility checks (`visible`), not transport serialization. The last
profile sampled 275ms in `children`, 140ms in `visit`, and 215ms in `visible` over the
whole dynamic workload. Those samples are not per-request latency and cannot simply
be subtracted from the provider's wall time.

Earlier profiler runs had unavailable tab-status observations, and one used an
insufficient completion predicate that ignored queued roots. Their output is diagnostic
only, not evidence of complete page processing.

## Findings and next experiments

1. Parallelism already exists: every batch in a stream starts as an independent
   backend task. Whole-page latency follows the slowest result, not median inference.
2. Blindly doubling request count did not reliably improve YouTube and hurt the
   large Wikipedia workload. Keep the production batch size unchanged for now.
3. YouTube's changing DOM creates additional waves and repeated evidence; test
   page-scoped exact-evidence coalescing rather than persistent database caching.
4. Profile redundant ownership/visibility work per synchronous scan. Reuse within
   one pass can avoid DOM walks without weakening freshness across asynchronous waits.
5. Stream extracted batches as they become ready only after measuring whether it
   improves time-to-first-result without duplicating/narrowing ownership decisions.

The sub-300ms whole-page objective is **not met**. Several real first responses alone
exceeded 300ms. No amount of client-side parallelism can guarantee a deadline shorter
than an external request that has already exceeded it. Optimize controllable overhead
and measure first useful removal separately from completion of all loaded content.
No classification policy, production batching, or accuracy behavior was changed in
this benchmark work, and these latency runs do not establish classification accuracy.

## Follow-up: alternate batch order and redundant visibility checks

`BENCH_BATCH_SIZES=20,10,5,1 BENCH_ROUNDS=3 bun src/extension/tests/sites-latency.real.ts youtube`

A fresh YouTube snapshot contained 64 blocks and 20 video cards. Discovery plus
extraction took 75ms. Every trial checked all 64 blocks with real Jev and no errors.
Trials alternate ascending/descending batch-size order, reducing (not eliminating)
connection-warmth bias. This remains a small sequential sample, not a statistical SLA.

| Blocks per request | Requests | Whole-judgment times, ms | Median, ms |
| --- | ---: | --- | ---: |
| 20 | 4 | 530, 295, 321 | 321 |
| 10 | 7 | 517, 305, 542 | 517 |
| 5 | 13 | 500, 514, 335 | 500 |
| 1 | 64 | 839, 890, 835 | 839 |

Even the fastest trial took approximately 370ms including extraction. Do not
switch to one-block requests to chase concurrency: this sample shows a substantial
regression in whole-workload completion despite sometimes fast first results.

`bun src/extension/tests/scanning-latency.browser.ts`

The first in-memory build variant checked whether an element is a link/media candidate
*before* asking for its computed visibility in evidence extraction. Production
previously checked visibility for every traversed element in that callback, although
only links/media contribute there. Text visibility is handled separately.

Ten alternating synchronous passes on each live DOM produced identical provider
evidence and coverage flags:

| Page | Blocks | Baseline extraction median | Experimental median |
| --- | ---: | ---: | ---: |
| YouTube | 63 | 31.3ms | 22.8ms |
| Wikipedia | 1,294 | 95.7ms | 78.1ms |

Comparison excludes module-local ownership/media identity token values, which differ
between separately loaded modules; it does not substitute for freshness regression
tests. This optimization was subsequently applied to production (see below).
The approximately 8.5ms YouTube saving is real in this sample
but insufficient to reach 300ms alongside observed provider tail latency.

## Implemented after approval

The evidence-extraction optimization is now in production source. Adapter/browser
tests cover 25 registered adapters and 44 rule shapes, plus media freshness tests.

`DocumentReuse` now coalesces identical evidence within one document, in backend
memory before receipt signing. It has a 60-second reuse window and a 4,096-entry
bound. Document ID, hostname, scheme, and complete normalized candidate evidence
form the key; candidate IDs/revisions are rebound only on independent result copies.
Reloads and other tabs use new document IDs. Nothing is read from a database cache.
Policy, model, and thresholds are fixed for the owning application lifespan.

The layer preserves original provider duration in `judge_ms`; a hit must not be
misreported as a new near-zero-ms model inference. Each caller still gets separately
prepared telemetry and fresh target-bound receipts. Accordingly, history `batch_id`
identifies a returned judgment batch, not necessarily a new provider evaluation.
`/health.document_reuse` exposes aggregate hit/miss/inference-batch counters without
content. `DENIED_DOCUMENT_REUSE=0` disables reuse for controlled comparisons.

Actual installed-extension YouTube runs after the scanner optimization:

| Reuse | Submitted blocks | Avoided evaluations | First result | Last result | Final pending / queued roots / errors |
| --- | ---: | ---: | ---: | ---: | --- |
| Disabled | 132 | 0 | 376ms | 3,003ms | 0 / 0 / 0 |
| Enabled | 148 | 40 (27%) | 488ms | 3,384ms | 0 / 0 / 0 |

These were different live loads, not matched workloads; they prove reduced provider
work, **not a wall-time improvement**. The enabled run evaluated 108 unique payloads
in 13 inference batches and delivered 14 logical response batches. The whole-page
300ms target remains unmet. Real-provider tests verify sharing, receipt rebinding and
replay rejection, separate documents, changed evidence/context, expiry/capacity,
failure eviction, cancellation isolation, and shutdown cleanup.

## Snapshot-local visibility reads

Evidence extraction now shares visibility reads between text extraction, media
metadata, and link labels within a single synchronous invocation. No cache survives
the invocation, including into a later removal freshness check. The real-browser
regression test first failed with eight computed-style reads for one split-text
link; it now reads once and verifies changed visibility/text on subsequent calls.

`src/extension/tests/scanning-latency.browser.ts` now compares cached visibility with uncached
visibility on the same live DOM. Ten alternating passes produced identical evidence:

| Page | Blocks | Uncached median | Cached median |
| --- | ---: | ---: | ---: |
| YouTube | 62 | 21.3ms | 21.45ms |
| Wikipedia | 1,294 | 347.9ms | 210.85ms |

These live loads differ from the earlier snapshot; only within-row comparisons
are meaningful. There is no demonstrated YouTube extraction improvement from this
particular optimization. Wikipedia benefited, with no changed payloads.

The rebuilt installed extension then processed a fresh YouTube load using real
Jev calls: 144 submitted blocks, 121 unique evaluations, 23 reuse hits, 16 inference
batches, and zero errors/pending/deferred blocks when settled. First result was
387ms after first dispatch, median response-batch time approximately 302ms, and last
result 5,181ms after first dispatch. Navigation-to-first-dispatch was 3,722ms. This
includes the live page's evolving DOM and incremental scheduling; it is **not** a
fixed-snapshot inference measurement or proof of a regression relative to another
live load. Classification accuracy was not manually adjudicated by this benchmark.
The whole-page <300ms objective remains unachieved.

## Provider fan-out and transport experiments

Commands (no production request-path changes):

```sh
BENCH_PROVIDER_SHAPES=1 bun src/extension/tests/sites-latency.real.ts youtube speedtest
BENCH_PROVIDER_SHAPES=1 BENCH_TRANSPORT=1 bun src/extension/tests/sites-latency.real.ts youtube speedtest
```

These use production `build_request` on every block in a live public snapshot.
The direct-provider benchmark excludes backend signing, extension messaging, and
animation. It validates every returned score and question ID. Three alternating
trials per configuration are exploratory evidence, not a latency SLA. The HTTP/2
dependency is supplied only to the benchmark via `uv --with`; production is unchanged.

Splitting a 20-block request's 60 questions into three parallel category requests
preserves the full state and all policies but triples provider calls:

| Page | Blocks | Combined all-result times | Category-split all-result times |
| --- | ---: | --- | --- |
| YouTube | 63 | 647, 333, 247ms | 566, 298, 363ms |
| Speedtest | 47 | 635, 242, 330ms | 672, 349, 310ms |

There were no threshold disagreements in these samples. Median completion got
worse on both pages; faster first category results do not establish faster complete
classification. Keep combined requests. These initial category runs were captured
in command output; subsequent experiment runs also save aggregate artifact rows.

Separately, identical combined requests were compared over independent persistent
HTTP/1.1 and HTTP/2 clients, with negotiated protocol verified on every response:

| Page | Blocks | HTTP/1.1 all-result times | HTTP/2 all-result times |
| --- | ---: | --- | --- |
| YouTube | 63 | 583, 321, 269ms | 648, 314, 305ms |
| Speedtest | 41 | 579, 243, 304ms | 656, 360, 248ms |

Both protocols started cold in the first round. HTTP/2 does not show a consistent
advantage; do not add a production dependency on this evidence. One YouTube score
crossed a threshold between repeated calls despite identical semantic payloads;
this is observed provider variability, not evidence that transport changes policy.
Extraction added approximately 54ms on YouTube and 28ms on Speedtest in this run.
Even the fastest YouTube direct-provider trial exceeded 300ms with extraction.

## Rendered-tree enumeration

`renderedChildren` now walks `firstChild`/`nextSibling` instead of spreading live
NodeLists. Evidence extraction and ownership traversal share this implementation.
It still snapshots child arrays, resolves assigned slots with fallback, walks open
shadow roots, excludes unassigned light DOM, and rereads on every invocation.

The browser regression first failed with six childNodes reads, then passed with
zero; rendered order, overlapping-root deduplication, slot fallback, and changed
text were preserved. Adapter checks (25 adapters / 44 shapes), media checks,
typecheck, and the extension build passed.

`BENCH_TREE=1 bun src/extension/tests/scanning-latency.browser.ts` compares both enumeration
strategies synchronously on the same DOM. Ten alternating discovery-plus-extraction
passes yielded identical target identities/order and provider evidence:

| Page | Blocks | NodeList median | Sibling traversal median |
| --- | ---: | ---: | ---: |
| YouTube | 63 | 54.95ms | 45.9ms |
| Wikipedia | 1,311 | 181.05ms | 175.35ms |

Fresh cross-site real-Jev runs with the new scanner and 20-block batches:

| Page | Blocks | Scan + extraction | Snapshot-to-all results (three trials) |
| --- | ---: | ---: | --- |
| YouTube | 63 | 59ms | 674, 402, 386ms |
| Speedtest | 49 | 9ms | 280, 317, 321ms |
| Wikipedia | 1,294 | 703ms | 1,751, 3,622, 3,554ms |

Every trial returned all requested judgments without errors. Cold/live-page
extraction differs from repeated synchronous passes, including layout and runtime
warm-up costs; do not present the microbenchmark as end-to-end performance.
These measurements again contradict a general whole-page <300ms claim. The scanner
optimization is retained for its same-DOM benefit, not as a solution to provider
tail latency or large-page inference volume.

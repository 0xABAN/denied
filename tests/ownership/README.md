# Ownership and safe-removal experiment

This suite tests the distinction between identifying prohibited content and removing
the complete item around it. The prototype under `extension/src/ownership/` is **not
imported by the shipping content script**. No production classifier, database,
extension settings, or running backend is changed by these commands.

## Corpus and labels

`corpus.ts` contains **48 individually authored synthetic scenarios**, with 34 in the
development split and 14 initially held out from prompt/threshold tuning. Each specifies the
seed passage, expected removal roots, explicit preserved nodes, and the reason for
the case. Review these labels as product-policy expectations, not independently
validated ground truth.

The scenarios cover chat layouts, shared identities/controls, nested replies,
disjoint removal sets, products and table rows, benign discussion of purchases,
scam-prevention text, multilingual sales, prompt injection, misleading markup,
open/nested shadow roots, assigned slots, display-contents, and private composers.

Every case also runs with extra wrappers and changed classes/styles: **144 rendered
variants, not 144 independently authored examples**. The holdout is synthetic and
shares the corpus author; it is not an unseen-websites evaluation.

`challenge.ts` adds **24 independently authored scenarios**, including multiple
preserved replies, controls after a reply, shared branding, form-free composers,
quoted sales/scam guidance, and misleading disclaimers. Together these make **72
authored scenarios and 216 rendered variants**. The challenge cases were authored
before evaluating the whole-scope arm on them, but their results have subsequently
informed development. Neither corpus split is now an untouched validation set.

## Commands

From the repository root:

```sh
# Inspect the current shipping scanner’s coverage gaps. No model calls.
bun tests/ownership/baseline.browser.ts

# Require gap-free baseline coverage (currently fails intentionally).
bun tests/ownership/baseline.browser.ts --require-coverage

# Actual Chromium observation and deletion contracts. No model responses involved.
bun tests/ownership/contracts.browser.ts

# Whether the proposal grammar contains each labeled scope; no AI calls.
bun tests/ownership/plans.browser.ts

# Actual Jev -> validated plan -> actual DOM deletion, across all 144 variants.
# Requires TYPESAFE_API_KEY in backend/.env; makes 192 provider requests.
bun tests/ownership/real.ts

# Smaller, still real evaluations:
bun tests/ownership/real.ts --original-only
bun tests/ownership/real.ts --development-only

# Whole-scope Choice, with classification from the complete neighborhood:
bun tests/ownership/real.ts --plans

# Speculative classification of each proposed scope in the same request:
bun tests/ownership/real.ts --plans --classify-scopes

# Policy-free grouping and scope classification in two parallel requests:
bun tests/ownership/real.ts --plans --classify-scopes --split-contexts

# Experimental categorical relationships; cutoff is an experimental parameter,
# not a calibrated safety guarantee. 336 provider calls for the original corpus.
bun tests/ownership/real.ts --plans --classify-scopes --split-contexts --relations --membership-cutoff=0.8

# Add --challenge-only to use the 24 challenges instead (168 provider calls
# with all three variants and split contexts). --original-only reduces either run.

# Analyze a saved run’s development split without another provider call.
bun tests/ownership/analyze.ts artifacts/ownership-real-<timestamp>.json
```

Request-construction checks run from `backend/`:

```sh
uv run python -m unittest discover -s tests -p test_ownership_contract.py -v
```

The real suite exits unsuccessfully on any wrong scope, missed required part, or
provider error. It retains a timestamped JSON report under ignored `artifacts/`.
Scores are validated through the same strict Noul schema used by the backend.
There are no mocked services, intercepted responses, or heuristic classifications.

## What each layer measures

- **Shipping baseline:** whether the scanner loses eligible light-DOM text when
  deduplicating candidates. This is not a model evaluation or full visibility audit.
- **Browser contracts:** independent enumeration checks capture coverage and unique
  node references. Explicit approved sets test the actual removal executor, not AI
  accuracy. All unapproved observable atoms must remain connected, not just the
  named neighbors. Additional checks cover limits, unknown IDs, partial approvals,
  changed/replaced/reparented nodes, new replies, links, slots, disabled filtering,
  privacy/hidden ancestors, and synchronous custom-element callbacks.
- **Real evaluation:** the known seed passage and observed local DOM are sent to Jev.
  The shipping ad/safety policy and thresholds are reused. The original arm evaluates
  ownership independently per atom at cutoff 0.9. The scope arm compares complete
  included/preserved sets. The relation arm categorizes each part as same-item,
  other-item, shared-interface, or unknown, then accepts same-item membership above
  the configured cutoff. These cutoffs are not calibrated confidence. Fixture names, original
  IDs/classes, expected roots, and labels are not sent to the provider.
- **Proposal grammar:** actual ancestors with a preserved contiguous run of sibling
  subtrees at any depth; no site names, class-name patterns, or visual card thresholds.
  This can preserve several adjacent replies without a common wrapper. It is not
  an exhaustive enumeration of arbitrary discontiguous masks. Options are deduplicated
  and capped at 64; exhausting that budget is reported as incomplete. Private,
  outside-observation, and unobservable anchors cannot authorize proposals.
- **Scoped classification:** all proposed items can be judged speculatively before
  knowing which scope will be selected. Only the selected scope’s classification
  is used. A relation mask not present in the pool falls back to the seed and is
  reported explicitly; it never borrows a different scope’s classification.
- **Latency comparison:** original cases receive an additional classification-only
  call, with order alternated and six concurrent fixture jobs on persistent connections.
  Split-context jobs issue two parallel provider requests, with up to 12 connections.
  Durations include network/startup overhead. These are singleton fixtures, **not**
  the production twenty-item batching or 600-block-wave throughput benchmark.

The seed and context root are supplied by the harness. Selecting candidate seeds
and bounded contexts automatically on arbitrary sites remains integration work.
No claim is made about image interpretation, closed roots, frame contents, CSS-only
visual content, or complete visibility/occlusion detection. The current signatures
protect node identity, content, structural membership and addresses; they deliberately
ignore geometry changes, so this is not a complete visual-state freshness guarantee.

## Recorded first evaluation — September 19, 2026

Source artifact: `artifacts/ownership-real-1789827895207.json`.
Model: `jev-latest`. Prompt/criteria hash:
`0f9c3bff41f98110505997e59280fdaade87907782398a90ee65341b4a072e47`.

- Shipping scanner: light-DOM coverage gaps in **41/48** authored scenarios.
- Prototype contracts: **162 checks passed**: 144 variants plus 18 safety/mutation
  cases. Observation median was about **0.4 ms**, p95 **0.6 ms**, on these small
  local fixtures. These are not whole-page extraction measurements.
- Real Jev: **192 calls**, no provider errors. Classification matched all **144/144**
  labels. Exact removal scope matched **24/144** variants; **120** left required
  pieces behind. No collateral removals were observed at the frozen cutoff.
- Original scenarios: **8/48** exact; those were the five benign cases and three
  cases requiring only the seed. **None of the 40 expanded/disjoint removals was
  complete.** A high keep-neighbor rate must not conceal this failure.
- Synthetic holdout: **9/42** variants exact; 33 incomplete and no observed collateral
  removals. All 42 classifications matched their labels.
- Matched original-fixture timing: ownership-call median **208.5 ms**, p95 **451.08 ms**;
  classification-only median **197.1 ms**, p95 **402.26 ms**. This does not establish
  the overhead under production batching or representative real websites.

An offline **development-only** cutoff sweep found the expected trade-off:

| Ownership cutoff | Exact / 102 | Cases with collateral removal | Incomplete cases |
| --- | ---: | ---: | ---: |
| 0.60 | 90 | 6 | 6 |
| 0.75 | 75 | 1 | 26 |
| 0.80 | 67 | 0 | 35 |
| 0.90 | 15 | 0 | 87 |

These are diagnostic results, not a newly validated threshold. The frozen prompt
and threshold were not changed after inspecting the holdout. The ownership model
path is **not ready for production**. Preserve the corpus and executor checks as
the evaluation gate for the next ownership approach.

## Subsequent architecture experiments — September 19, 2026

These runs are iterative development measurements, not independent validation.
The shipping extension and API remain unchanged.

| Arm and corpus | Exact scope | Correct classification | Collateral cases | Median round trip |
| --- | ---: | ---: | ---: | ---: |
| Whole scope, neighborhood classification; original variants | 134/144 | 138/144 | 4 | 209.04 ms |
| Policy-free relations, scoped classification, cutoff 0.8; original variants | 132/144 | 144/144 | 5 | 263.99 ms |
| Same relation arm; challenge variants | 71/72 | 72/72 | 0 | 283.97 ms |

Source artifacts, respectively:

- `artifacts/ownership-plans-1789829538772.json`
- `artifacts/ownership-plans-1789830039808.json`
- `artifacts/ownership-plans-1789830033877.json`

The latest combined relation runs reached **203/216 exact scopes** and **216/216
correct classifications**, with **five collateral** and **eight incomplete** cases.
The last two timing rows include waiting for both parallel requests. Their p95s
were 467.4 ms and 454.33 ms; they do not establish a 300 ms tail-latency guarantee.
No inference cache, backend database, or authenticated browsing session is involved.

Key findings:

- Independent high-threshold ownership votes are too conservative to assemble
  whole items. Choosing complete alternatives is substantially better on this corpus.
- Whole-neighborhood classification can let a warning reply sanitize the scam it
  answers. Classifying proposed item content separately avoids that contamination.
- Conversely, isolating a quoted sales/scam passage can remove legitimate guidance.
  Ownership must describe the item currently presenting a quotation, not merely
  the quoted original speaker. The grouping contract now makes that explicit.
- Richer duplicated Choice descriptions did not improve the challenge result and
  were reverted. Splitting moderation policy from grouping helped some scopes, but
  two requests cost more than one and have not been tested at production throughput.
- A confidently wrong scope still occurs. Lowering/raising a cutoff is not a
  substitute for ownership accuracy. Relations improved the new challenges but
  regressed some original scopes; this is not a selected production replacement.
- Some current atoms are not independent content: empty slot nodes and container
  accessibility metadata require ownership votes alongside real text/media. That
  representation needs investigation rather than site-specific exceptions.

Current deterministic checks: **234 browser contracts** (216 variants plus 18
mutation/safety cases); **216/216 candidate recall** plus four proposal-boundary
checks; five request-construction checks; TypeScript type checking. These results
prove those contracts, not AI accuracy. The proposal set reached at most 17 options
on these small fixtures.

Before integration: freeze a candidate architecture, evaluate independently sourced
real layouts, automate bounded seed/context selection, resolve non-content atom
semantics without losing coverage, test uncertainty/abstention, and benchmark the
actual multi-item/wave transport. The current fixtures supply both the seed and
context root, so their results must not be described as end-to-end website accuracy.

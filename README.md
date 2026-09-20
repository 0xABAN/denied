## Inspiration

Kids do not have to search for something dangerous to encounter it. Ads, sales pitches, scam-like comments, unsafe links, and harmful pages are mixed into the sites they already use. Traditional blockers often depend on brittle selectors, so a new layout can let the same problem through.

We built noped! as a general guardrail for under-13 browsing. It looks at the visible block, makes a fast decision, and removes the block without taking the whole page away.

## What it does

noped! is a Chrome parental-control extension.

- It sends bounded visible content blocks to !(Jev)[https://typesafe.ai/], a semantic decision-maker up to 193x faster & 444x cheaper than traditional LLMs.
- Jev returns structured keep/remove judgment for hundreds of HTML blocks in near real-time on any given webpage
- noped! removes ads, sales offers, scam-like content, unsafe links, and other blocks that cross the configured safety policy.
- When Jev flags an unsafe site at the domain level, the site gets noped! 
- Telemetry gets logged via Tiger Data for debugging misses, latency errors, and accuracy 

## How we built it

noped! uses a Manifest V3 Chrome extension with TypeScript and Bun, a FastAPI/Python backend, PostgreSQL-backed telemetry, and Jev inference.

The scanner walks the rendered page, extracts bounded evidence for visible blocks, and sends up to 20 blocks per Jev request, scalable up to several dozens of requests per go. The task is embarrassingly paralle; results stream back as independent batches, so the first useful decision does not wait for every block on the page. A domain gate runs before content scanning for top-level navigations.

The removal layer uses the Web Animations API and freshness checks. If a page changes while a decision is in flight, noped! verifies that the same block is still present before removing it. The backend records judgments, removals, domain decisions, policy versions, and timing data without using the database as a cross-site judgment cache.

## Challenges we ran into

The hardest part was not finding one bad word. It was deciding what counts as one visible block on a real page. A sender, subject, image, link, and parent container can be separate DOM nodes, while a page can re-render between discovery and removal.

We also had to separate model latency from everything around it. Real measurements showed that rendered-tree traversal, visibility checks, changing page state, transport, and animation all affect the time a child sees before content disappears. That led us to stream batches, reuse identical evidence only within the backend process, and verify removals against the current DOM.

## Accomplishments that we're proud of

- A working domain-level block page alongside block-level removal.
- Structured Jev decisions integrated into a live browser extension.
- A telemetry path that lets us inspect misses, timing, and policy behavior.
- A playful removal animation that makes the intervention visible without obscuring the rest of the page.

## What we learned

A fast classifier is only part of a safe browser product. The scanner, ownership boundaries, streaming path, freshness checks, and failure behavior matter just as much. We also learned that a general evidence pipeline scales better than adding one more selector for every new website.

## What's next for noped.

We want to evaluate noped! with families and child-safety organizations, improve block grouping without relying on brittle site-specific heuristics, and measure time to the first useful removal across more real sites. The long-term goal is a practical safety layer that helps children explore the web while preserving access to ordinary pages.

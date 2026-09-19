# Benchmark

Measure autonomous full-game Hollow Knight completion. A single encounter or level does not satisfy the objective. HopHacks provides a 36-hour development window, not a reduced task.

## Functional requirements

- Specify game version, starting state, target ending, allowed prior knowledge, and resource limits.
- Run the harness and engine under the same declared conditions; record gameplay, inputs, model/configuration versions, deaths, costs, and interventions.
- Verify completion from recorded evidence. Use progression and survival as diagnostics, not substitutes for completion.

## Non-functional requirements

- Unmodified game, screen-derived observations, ordinary inputs, and no web search or privileged game-state access.
- Report failures and interventions honestly; distinguish a working controller from a completed run.
- Known gap: geo balance is not read from the HUD.
- Keep recording from blocking control and preserve enough evidence to reproduce failures.

## Reference

[RuneBench](https://maxbittker.github.io/runebench/) is the public-site shape: methods, scored runs, trajectories, cost, and limitations on one page. Copy the evidence board, not the task. RuneBench scores max XP rate on an emulated server with a TypeScript SDK and wiki files. This benchmark stays full-game Hollow Knight, screen-only, ordinary inputs, no game API.

## Site stack

- **Frontend:** Bun, TypeScript, React, Next.js, Tailwind. Host on Vercel.
- **Ingest:** Python (FastAPI) from engine/harness logs: run id, models, timing, deaths, cost, interventions, completion evidence.
- **Live store:** SpacetimeDB. Engine/harness write run rows and in-progress telemetry; the site subscribes. No Postgres unless a later prize needs it.
- **Sponsor extras:** HopHacks Fall 2026 MLH currently lists Gemini, ElevenLabs, Solana, Tiger Data, Backboard, DigitalOcean, Snowflake, GoDaddy. Add one only to chase that prize.

## Open

Completion ending, initial save, prior-knowledge policy, run limits, intervention rules, and time-control rules.

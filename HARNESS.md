# Harness

The planning and memory component. Core model: Qwen 3.8 27B via Cerebras, as requested; exact API identifier and availability remain unverified.

## Functional requirements

- Own objectives, exploration, pathfinding, backtracking, progression, and recovery plans.
- Maintain motion summaries, recent actions/outcomes, and persistent world knowledge. Preserve facts, uncertainty, unresolved goals, and failed approaches across compaction.
- Plan a concise MEMORY.md for durable facts, decisions, and recovery context, with AGENTS.md symlinked to it. Update memory before compaction; exclude transcripts and credentials. Document this contract now; create the files during implementation.
- Consider local traversal maps plus a persistent graph of places, directed connections, obstacles, and ability requirements.
- Consume engine observations and outcomes; publish versioned objectives, relevant memory, and typed Jev questions with grounded choices.
- Replan on discoveries, changed abilities, death, or stalled progress. Keep dispatched actions distinct from observed success.

## Non-functional requirements

- No web search.
- Keep Qwen planning outside the real-time loop; reuse query templates and compact context between updates.
- Bound context size; retain evidence and uncertainty rather than inventing missing state.
- Validate query/action contracts before publishing them. Jev questions in one request are independent, not a sequential plan.

## Relevant Jev apps

Closest public patterns. Index: [awesomejev.com](https://awesomejev.com/).

- [fhshaik/typesafe-mario](https://github.com/fhshaik/typesafe-mario): object-centric state; Choice over legal macros; Noul jump-now; Score danger. Timing facts stay in code.
- [shantanugoel/mario-jev](https://github.com/shantanugoel/mario-jev): same split, focused movement/jump questions.
- [RomanSlack/jev-drone](https://github.com/RomanSlack/jev-drone): CV → JSON; Choice maneuver + Score risk + Noul target-lost; code vetoes unsafe climbs; ask only when the scene changed.
- [phyous/tsai-sc](https://github.com/phyous/tsai-sc): keyboard/mouse on original StarCraft; separate Economy vs Army menus; Continue is an option.
- [lukaske/jev-doom-agent](https://github.com/lukaske/jev-doom-agent): structured spatial state, combat vs navigation rates.
- Official Doom/Wikiracing: [TypeSafe launch](https://typesafe.ai/blog/introducing-system-one-models-and-jev). Docs: [primitives](https://docs.typesafe.ai/primitives).

Copy: grounded IDs, `none`/`hold`/`continue`, independent questions, geometry in code, goal in `state` not in another answer. Do not copy privileged RAM or a single Choice over raw buttons.

## Default Jev questions

Engine fills option IDs from current tracks. Ask the tick set together (speculative fan-out); code ignores answers that do not apply. One snap judgment per question. Criteria describe situations.

### Tick

**threat** · Score · How dangerous is the Knight's immediate situation given `threats`, `terrain.hazards`, and `player.masks`?
- Clear: nothing closes within reaction time.
- Pressured: a hit lands if the current action continues.
- Lethal: a hit lands before another skill can start, or one hit kills.

**interrupt** · Noul · Should `recent.maneuver` be aborted now?
- true: continuing loses to a closing hit, a missed pogo, a walk-off, or a cancelled focus.
- false: the committed action is still valid.

**attack** · Choice · Which attack should fire this decision? Serve `objective`. Do not pick a windup that loses to a closing hit.
- `none`: no punish, or attacking eats a hit / wastes soul.
- `nail_{id}`: that enemy is in nail range with a punish window.
- `pogo_{id}`: down-slash bounce on that enemy or hazard; landing is clear.
- `spell_{id}_{tid}`: that spell on that target; soul cost is available (Vengeful Spirit / Shade Soul, Desolate Dive / Descending Dark, Howling Wraiths / Abyss Shriek).
- `nail_art_{id}`: charged Great Slash, Dash Slash, or Cyclone; the charge is ready and the window holds.
- `focus`: missing masks, enough soul, and the focus window is not interrupted.

**evade** · Choice · Which evasion, if any?
- `hold`: no dodge needed.
- `dash_away`: dash increases separation from the closest closing threat.
- `dash_through`: Shade Cloak i-frames beat a threat we cannot outrun.
- `jump`: leave the floor to clear a low attack or start a gap.
- `wings`: Monarch Wings extra air jump.
- `cling`: Mantis Claw wall is safer than the floor.
- `retreat`: walk/dash along `terrain.safe`.

**move** · Choice · Which movement best serves `objective` without walking into `threats` or `terrain.hazards`?
- `hold`
- `toward_objective`: along the harness route.
- `to_{id}`: that observed waypoint, exit, ledge, or crystal-dash lane.
- `chase_{id}`: close on that enemy for a punish.
- `reposition`: circle to a safer angle for the current attack.
- `to_bench`: masks critical and a bench path is known.

**superdash** · Choice · Which Crystal Heart lane, if any? Omit if the ability is locked or no clear lane is observed.
- `none`
- `{id}`: that horizontal/diagonal lane; relative geometry is in state.

**gap_commit** · Noul · Should we commit to the current jump/dash/wings/crystal-dash across `terrain.gap`?
- true: speed, air time, and landing are enough given `reaction_timing`.
- false: we will miss, or a hazard occupies the landing.

### On room / death / stall

**objective** · Choice · Which harness-supplied objective should we pursue now? Options are the current plan plus discovered alternatives (ability gate we can now pass, dreamer, nail/spell upgrade, recover shade, bench, boss retry). Include `keep` if the current objective still holds.

**exit** · Choice · Which observed exit or waypoint advances `objective`?
- `{id}`: each visible door, transition, bench, NPC, lever, stag, tram, or dream gate.
- `stay`: this screen still has required combat or loot.
- `unknown`: localization is too weak to pick.

**after_fail** · Choice · After repeated death or stall, what next?
- `retry`: same approach; the failure was execution.
- `other_route`: this path is wrong or ability-gated.
- `bench`: heal/save before another attempt.
- `shade`: retrieve geo/soul from the shade; path risk is acceptable.
- `relocalize`: map and pose disagree.

**stalled** · Noul · Does recent evidence show no progress on `objective` (same screen, no new exits, repeated deaths, no damage)?

**shade_worth** · Noul · Is fighting `shade` worth the path risk given `player.masks`, `player.soul`, and known enemies on the route?

**progress** · Score · How strongly do observations support finishing the current maneuver?
- Failed or reversed.
- Still in progress, outcome unclear.
- Landing/hit/interaction already confirmed.

## Open

Model API identifier/access, planning cadence, runtime memory storage, compaction policy, and measured question accuracy.

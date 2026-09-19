# Engine

The real-time perception, Jev inference, and input-execution component.

Flow: game frames → state estimation → harness context + Jev queries → Jev → validated inputs → game. Observations and outcomes feed the harness.

## Functional requirements

- Capture the unmodified game; control it through ordinary keyboard/controller inputs. No mods, process-memory reads, or hidden game APIs.
- Fine-tune YOLO26s-seg as primary perception. SAM 2.1 Tiny is the backup if YOLO proves inadequate; resolve prompting/classification and validate freshness before adoption.
- Estimate player, enemies, projectiles, terrain, hazards, interactables, HUD, and menus. Consider ByteTrack/BoT-SORT and HUD template readers.
- Track identities and recent motion; compute relative geometry, velocity, camera movement, and events locally. Timestamp observations and distinguish predictions from facts.
- Combine fresh state with the harness's current decision context, query Jev, and execute bounded, interruptible actions.
- Validate decisions against current state; report execution status and observed outcomes. Support combat, traversal, interaction, menus, and death recovery.

## Non-functional requirements

- Keep perception running during API calls. Publish coherent latest-state snapshots; bound queues and discard stale work.
- Target roughly 10-15 ms for the local state pipeline, excluding frame wait and Jev latency; validate on actual hardware.
- Measure capture-to-input freshness and tail latency. Observed sub-80 ms Jev responses are not a guarantee.
- Keep vision local, state assembly inexpensive, and slow planning off the action path.
- Release inputs on failures; provide interruption and record timing, uncertainty, decisions, and outcomes.

## Labeled data

Primary footage: [this ~3h Hollow Knight VOD](https://youtu.be/G1atkq4C1KU). Crop runner overlays. Sample a few fps plus room-change / hit / death frames, not every frame. Do not label enemy species, HUD digits, nail VFX, or background art. One route will miss skipped areas; add clips only for those rooms if the detector fails there.

**Boxes + masks**
- `knight` — the player; mask used for feet/hitbox
- `enemy` — any hostile; add `boss` only when the sprite is clearly a boss
- `projectile` — hostile shots; small-object heavy
- `hazard` — spikes, thorns, saws, acid, lava
- `solid` — walk/cling geometry in the playfield, not painted background

**Boxes**
- `shade` — death shade
- `bench`
- `interactable` — NPC, lever, gate, totem, stag, tram, dream nailable
- `collectible` — geo, relics, charm notches, soul chunks on the ground
- `breakable` — cracked walls, geo rocks, battle-gate props

**Not YOLO.** HUD is fixed-screen crops, not classes.
- Masks: template-match filled / empty / lifeblood icons in the health row.
- Soul: measure fill in the vessel crop (and extra vessels if present).
- Charms: read the inventory/pause screen once; persist the equipped set. Do not detect charm icons in the play HUD (they are not shown there). Knight-sprite changes from a few charms are optional later.
- Map / menu / dialogue: frame tag or a coarse `ui` box.

If `solid` masks are too slow to draw, derive walkable cells from where the knight stood or clung, and spike cells from deaths. Full terrain polygons are the upgrade.

## Limitations

- Geo HUD is unread. Shops, tolls, and shade-recovery value are decided without a geo count.

## Open

Runtime OS/GPU, capture/input backend, training coverage, perception accuracy, and measured latency budgets.

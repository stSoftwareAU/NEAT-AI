## Summary

Removed the deprecated `PREBUILD_SYNAPSE_THRESHOLD` static constant from
`Creature.ts`. This constant was superseded when the Creature class was
refactored into focused modules (Issue #1409), with the active version living in
`src/creature/CreatureTopology.ts`. No code referenced the deprecated
`Creature.PREBUILD_SYNAPSE_THRESHOLD` — all usages already point to the
`CreatureTopology` version. Closes #1487.

## Evidence

This is a pure cleanup change (removing 3 lines of dead code). No functional
behaviour changed:

- Verified via `grep` that no code references
  `Creature.PREBUILD_SYNAPSE_THRESHOLD`
- All 3823 tests pass via `./quality.sh`

## Test Plan

- No new tests needed — this removes unused dead code with no behavioural change
- All existing tests (3823) continue to pass

# Remove unused export of `PREBUILD_SYNAPSE_THRESHOLD` (Issue #3611)

## Summary

`PREBUILD_SYNAPSE_THRESHOLD` in `src/creature/CreatureTopology.ts` was exported
but had no importer anywhere in the repository — it is read only by
`prebuildInwardIndexIfLarge()` in its own module. The deprecated re-export from
`Creature.ts` was already removed under Issue #1487, leaving the `export`
keyword as public surface with no consumer. Dropped the keyword so the tuning
constant (Issue #1097) is module-private. Behaviour is unchanged. Closes #3611.

Verified before editing that no other `.ts` file, no `mod.ts` re-export, and no
non-TypeScript file (docs, scripts, config) references the name — a repo-wide
search returns only the declaration and the single internal comparison.

## Evidence

Backend-only change with no web interface, so there is no screenshot. Evidence
is the quality gate:

- `./quality.sh < /dev/null` → **exit 0**, `8064 passed | 0 failed | 4 ignored`.
- `deno check` (inside the gate) is the decisive proof for this change: any
  module still importing the constant would now fail to type-check.

## Test Plan

- Added
  `test/creature/CreatureTopology.ts::prebuildInwardIndexIfLarge - only
  builds for large creatures`
  — calls the module function directly and asserts on the observable outcome
  (`isInwardIndexBuilt`): a small creature does not build the inward index, a
  creature above the threshold does. This locks the threshold behaviour at
  module level now that the constant is private, without importing the constant
  itself.
- Existing coverage retained: `test/architecture/PrebuildInwardIndex.ts` already
  exercises the same threshold through the `Creature` facade after breed,
  mutate, and load.
- No tests were removed or commented out.

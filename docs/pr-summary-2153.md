## Summary

Validate that append-mode CRISPR DNA synapses have at least one resolvable source reference (`from`, `fromId`, or `fromRelative`) and at least one resolvable target reference (`to`, `toId`, or `toRelative`). Previously, a synapse with only a `weight` field would pass `validateDNA()` but fail during application with an unclear error. This is now caught at validation time with a clear `INVALID_DNA` error. Closes #2153.

## Changes

- **`src/reconstruct/validateDNA.ts`**: Added append-mode validation in `validateSynapse()` that checks each synapse has at least one source and one target reference.
- **`test/CRISPR/ValidateDNA.ts`**: Added 6 new tests covering missing source references, missing target references, no references at all, valid `fromRelative`/`toRelative`, valid `fromId`/`toId`, and default mode (implicit append) validation. Updated one existing test (`missing mode defaults to append`) to include valid source/target references, as the stricter validation now correctly rejects bare `{ weight: 1 }` synapses.

## Test Plan

- `validateDNA - append-mode synapse missing all source references throws`
- `validateDNA - append-mode synapse missing all target references throws`
- `validateDNA - append-mode synapse with no references at all throws`
- `validateDNA - append-mode synapse with fromRelative/toRelative passes`
- `validateDNA - append-mode synapse with fromId/toId passes`
- `validateDNA - default mode synapse missing source reference throws`
- All 5245 existing tests continue to pass

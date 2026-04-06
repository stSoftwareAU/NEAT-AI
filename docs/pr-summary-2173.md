## Summary

Add diversity-driven breeding to ensure fittest creatures periodically breed
with genetically distant newcomers (e.g., from Europa islands). Closes #2173.

Previously, both mother and father selection were fitness-biased, meaning
low-fitness newcomers with unique architectures were extremely unlikely to
be selected as breeding partners. This change adds a configurable
`diversityBreedingRate` that, when triggered, selects the most genetically
distant father instead of a fitness-biased one.

### Changes

- **`src/config/NeatArguments.ts`** — Added `diversityBreedingRate` field (range 0–1, default 0)
- **`src/config/NeatOptions.ts`** — Added `diversityBreedingRate` to numeric option keys
- **`src/config/NeatConfig.ts`** — Added parsing for `diversityBreedingRate` with default 0
- **`src/breed/ParentSelection.ts`** — Added `selectMostDiverseFather()` and
  `selectFatherFromCandidates()` functions. When `diversityBreedingRate` triggers,
  the father with the lowest `geneticCompatibility` score is selected instead of
  a fitness-ranked one. Normal intra-species breeding is unaffected when the rate is 0.

### Design decisions

- Default rate is 0 for full backward compatibility — no existing behaviour changes
- Diversity selection picks the single most genetically distant candidate using
  the existing `geneticCompatibility()` function (UUID-based neuron comparison)
- The mechanism is an additional breeding pathway, not a replacement for
  fitness-biased selection

## Evidence

All 5286 existing tests pass with 0 failures. 7 new tests added.

## Test Plan

- `test/breed/DiversityBreeding.ts` — 7 new tests:
  - `selectMostDiverseFather` picks the most genetically distant creature
  - `selectMostDiverseFather` selects first candidate when all equally diverse
  - `selectMostDiverseFather` prefers diverse over fit creatures
  - `findFather` with `diversityBreedingRate=1` always selects diverse father
  - `findFather` with `diversityBreedingRate=0` does not interfere with normal breeding
  - `diversityBreedingRate` defaults to 0 when not specified
  - `geneticCompatibility` confirms Europa creatures are genetically distant
- Existing `test/breed/ParentSelection.ts` tests continue to pass (no regression)

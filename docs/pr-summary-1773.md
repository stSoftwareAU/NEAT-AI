## Summary

Audit of breeding, creature lifecycle, and scoring tests (~72 files, ~387 test cases) across 8 directories: `test/breed/`, `test/Offspring/`, `test/creature/`, `test/score/`, `test/costs/`, `test/customCost/`, `test/CRISPR/`, and `test/intelligentDesign/`. Closes #1773.

### Changes made

**Duplicates removed:**
- Removed `test/Offspring/EditParentByIndex.ts` (1 weak test, wholly redundant with 9 comprehensive tests in `test/breed/EditParentByIndex.ts`)
- Removed 2 duplicate `editAliases` tests from `test/CRISPR/CRISPRUntestedPaths.ts` (already covered by `test/CRISPR/Aliases.ts`)

**"How" tests rewritten as "what" tests:**
- `test/Offspring/HiddenNeuronUUIDCache.ts`: Rewrote 3 tests that checked cache object identity (`result1 === result2`) to instead verify correct content of returned Sets

**Meaningless/weak tests strengthened:**
- `test/creature/CreatureActivationTypedErrors.ts`: Replaced placeholder tests with meaningful assertions verifying WasmError reason and message properties
- `test/creature/CreatureTrainingTypedErrors.ts`: Replaced manual if-throw with proper `assertEquals` assertions
- `test/score/WasmJsScoreParity.ts`: Replaced meaningless self-comparison (`wasmAvg === wasmAvg`) with real assertions (non-negative error, score bounds)
- `test/intelligentDesign/ImproveSquash.ts`: Fixed shuffle test that explicitly documented it wouldn't assert order changed

**Test names improved:**
- `test/score/OneHundredPercent.ts`: Renamed "100%" to "Creature with constant output achieves perfect score on matching dataset"
- `test/Offspring/Breed.ts`: Renamed "OffSpring", "CrossOver", "Match on UUID", "Many Outputs", "Copy Required Nodes" to descriptive behavioural names
- `test/Offspring/KeepOrder.ts`: Renamed "KeepOrder" to "Offspring.breed preserves valid neuron ordering"
- `test/Offspring/KeepSynapses.ts`: Renamed "KeepSynapses" to "Offspring.breed preserves key synapses between shared neurons"
- `test/Offspring/SortNeurons.ts`: Renamed "Sort Neurons" to "Offspring.sortNeurons places inputs first and outputs last"
- `test/Offspring/MapLookupOptimization.ts`: Renamed all tests from "MapLookupOptimization -" to "Offspring.breed -"
- `test/Offspring/GeneticCompatibility.ts`: Fixed typo "Compatibly" → "Compatibility"
- `test/CRISPR/CRISPR.ts`: Fixed typo "CRISPER" → "CRISPR tag"

**Debug artifacts removed:**
- Removed `console.info()` from `test/breed/Father.ts`
- Removed `console.log()` from `test/score/Penalty.ts` and `test/customCost/SimpleCustomCostTest.ts`
- Removed debug file writes (`.actual.json`, `.cross_over.json`, etc.) from `test/breed/Samples.ts`, `test/Offspring/Breed.ts`, `test/Offspring/KeepOrder.ts`, `test/Offspring/KeepSynapses.ts`, `test/Offspring/GeneticCompatibility.ts`
- Removed unused imports (`emptyDirSync`, `ensureDirSync`, `CreatureUtil`, `assertAlmostEquals`)

**Cross-area duplicates noted:**
- `test/Offspring/GeneticCompatibility.ts` overlaps with `test/breed/GeneticCompatibilityBehavioural.ts` (kept both as they test different scales — large creatures vs semantic properties)

## Evidence
- All 4507 tests pass
- `./quality.sh` passes cleanly (lint, format, type-check, tests)

## Test Plan
- No new tests added; existing tests improved, renamed, or consolidated
- Verified all remaining tests exercise real code with real assertions
- Verified no duplicate tests remain within scope

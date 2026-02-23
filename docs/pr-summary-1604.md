# PR Summary: Split Large Test Files (#1604)

## Problem

Eight test files exceeded 800 lines, making them difficult to navigate, review, and maintain. Large monolithic test files slow down code review and make it harder to identify which tests cover which functionality.

## Solution

Split the 8 largest test files into 27 smaller, focused test suites (~150-730 lines each). Each new file groups tests by topic/functionality and contains only the imports and helper functions it needs.

## Files Changed

### Deleted (8 original files)

| Original File | Lines | Tests |
|---|---|---|
| `test/discovery/DiscoveryRunner.ts` | 2,174 | 25 |
| `test/discovery/DiscoveryCandidates.ts` | 1,812 | 22 |
| `test/discovery/FailureCache.ts` | 1,405 | 31 |
| `test/discovery/CombinedCandidateSequentialApplication.ts` | 1,268 | 11 |
| `test/WasmCalculateError.ts` | 1,257 | 37 |
| `test/WasmSafeZoneAdjustment.ts` | 1,090 | 36 |
| `test/ErrorGuidedStructuralEvolution/NeuronDiscovery.ts` | 876 | 8 |
| `test/Creature.ts` | 842 | 34 |

### Created (27 new files)

**DiscoveryRunner** (5 files):
- `DiscoveryRunnerCore.ts` - Core functionality (throws, verbose, best improvement, coordinated, combined, no improvement)
- `DiscoveryRunnerCandidateEvaluation.ts` - Evaluation summaries, synapse/neuron eval, focus neurons, positive impact
- `DiscoveryRunnerRemovalCandidates.ts` - Removal evaluation, slot reservation
- `DiscoveryRunnerFailureCache.ts` - Cache creation, skip cached, Phase 2 cache
- `DiscoveryRunnerConfiguration.ts` - Min candidates per category, default values, cache logging

**DiscoveryCandidates** (5 files):
- `DiscoveryCandidatesIndividual.ts` - Individual synapse/squash/neuron candidates, best-of-category
- `DiscoveryCandidatesCombined.ts` - Combined candidates across categories, bias adjustment
- `DiscoveryCandidatesSynapseOps.ts` - Harmful synapse removal, null/missing synapse handling
- `DiscoveryCandidatesPruning.ts` - Pruning, sorting, mixed types
- `DiscoveryCandidatesForwardOnlyVersionBump.ts` - Forward-only version bump test

**FailureCache** (4 files):
- `FailureCacheKeys.ts` - extractExponent, formatWeight, buildCacheKey variants
- `FailureCacheOperations.ts` - record/check, combo caching, directory creation
- `FailureCacheErrorReduction.ts` - Error reduction tracking, Rust integration
- `FailureCacheCoordinatedStructuralKeyBucketing.ts` - Coordinated structural key bucketing

**CombinedCandidateSequentialApplication** (3 files):
- `CombinedCandidateNeuronOps.ts` - Add+remove neurons, forward-only, neuron chains
- `CombinedCandidateRemoval.ts` - Multiple removals, descriptions, emojis, reconnection
- `CombinedCandidateSynapseRemoval.ts` - Synapse removal descriptions

**WasmCalculateError** (3 files):
- `WasmCalculateErrorBasic.ts` - Init + 16 activation functions (Identity through BipolarSigmoid)
- `WasmCalculateErrorAdvanced.ts` - Remaining functions + aggregates + edge cases
- `WasmCalculateErrorComprehensive.ts` - Comprehensive comparison test

**WasmSafeZoneAdjustment** (3 files):
- `WasmSafeZoneAdjustmentBasic.ts` - Init + 16 functions (IDENTITY through BipolarSigmoid)
- `WasmSafeZoneAdjustmentAdvanced.ts` - Remaining functions + aggregates + non-finite
- `WasmSafeZoneAdjustmentComprehensive.ts` - Comprehensive comparison

**Creature** (2 files):
- `CreatureMutations.ts` - Mutation tests, structure/properties, serialisation
- `CreatureTrainEvolve.ts` - Logic gate train/evolve + math function train/evolve

**NeuronDiscovery** (2 files):
- `NeuronDiscoveryIntegration.ts` - Integration tests requiring Rust + scenario helpers
- `NeuronDiscoveryUnit.ts` - addHelpfulNeurons unit tests

## Verification

- All 4,374 tests pass (0 failures)
- `./quality.sh` passes (fmt, lint, type-check, tests)
- No test logic modified - only file boundaries changed

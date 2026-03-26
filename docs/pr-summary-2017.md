## Summary

Replace defensive try-catch wrappers around `Creature.fromJSON()` in all 6 discovery operations with direct calls, now that root causes of invalid creatures have been fixed (#2013, #2014, #2015, #2016). Pre-validation via `assertValidSynapseReferences()` (already in place) catches any structural issues before `fromJSON()` is called, so invalid creatures will cause immediate assertion failures with diagnostics rather than being silently discarded. Closes #2017.

## Changes

- **DiscoverySynapseOps.ts**: Removed try-catch from `removeSynapse()` and `addHelpfulSynapses()`
- **DiscoveryNeuronRemoval.ts**: Removed try-catch from `removeHarmfulNeuron()` and `removeLowImpactNeuron()`
- **DiscoveryNeuronAddition.ts**: Removed try-catch from `addHelpfulNeurons()` and `changeSquash()`
- **DiscoveryFromJSONRobustness.ts**: Updated test descriptions and added 6 new tests verifying each operation produces structurally valid creatures

## Evidence

All 5018 tests pass including 16 tests in the updated robustness test file and 7 in the integrity test file.

## Test Plan

- Existing tests for invalid candidate handling (non-existent neurons) retained and passing
- Added `removeSynapse produces a structurally valid creature`
- Added `addHelpfulSynapses produces a structurally valid creature`
- Added `removeHarmfulNeuron produces a structurally valid creature`
- Added `removeLowImpactNeuron produces a structurally valid creature`
- Added `addHelpfulNeurons produces a structurally valid creature`
- Added `changeSquash produces a structurally valid creature`

## Summary

Merge milestone 'Discovery/Compact Structural Integrity' to Develop. Closes #2024.

This PR merges all completed work from the `milestone/discovery-compact-structural-integrity` branch, which includes structural integrity validation and fixes across compact, discovery, and parallel merge operations.

### Closed issues in this milestone
- #2012: Add `CreatureExport` synapse reference validation utility (`AssertValidSynapseReferences`)
- #2013: Audit and fix compact operations to prevent invalid creatures
- #2014: Audit and fix parallel merge operations to prevent invalid creatures
- #2015: Audit and fix orphaned neuron cleanup to prevent dangling synapse references
- #2016: Audit and fix discovery operations to prevent invalid creatures
- #2017: Replace try-catch masking with assertions after root cause is fixed

### Key changes
- New `AssertValidSynapseReferences` utility for validating synapse-neuron references in `CreatureExport` objects
- Post-operation structural integrity assertions added to compact, parallel merge, orphaned neuron cleanup, and discovery operations
- Comprehensive test suites for each area covering corner cases and invalid creature prevention

## Evidence
All 5012 tests pass, including new test suites:
- `test/architecture/AssertValidSynapseReferences.ts` — validation utility tests
- `test/compact/CompactCreatureIntegrity.ts` — compact operation integrity tests
- `test/compact/OrphanedNeuronCornerCases.ts` — orphaned neuron cleanup corner cases
- `test/compact/ParallelMergeCornerCases.ts` — parallel merge corner cases
- `test/ErrorGuidedStructuralEvolution/DiscoveryOperationIntegrity.ts` — discovery operation integrity tests

## Test Plan
- All existing tests continue to pass (5012 passed, 0 failed)
- New tests from milestone issues verify structural integrity after each operation type

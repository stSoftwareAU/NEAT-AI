## Summary

Audit and fix parallel merge operations to prevent invalid creatures. Closes #2014.

Added `assertValidSynapseReferences()` integrity assertions after the synapse
filter and neuron removal steps in both `mergeParallelIdentityBridges()` and
`mergeParallelBridges()`. These assertions catch dangling synapse references
immediately at the point of mutation, matching the pattern already used in
other compact operations in `CompactCreature.ts`.

Added 7 corner-case tests covering edge cases that could produce invalid
creatures. No bugs were found during the audit — the existing duplicate-source
check and the strict bridge detection (exactly 1 inbound + 1 outbound)
already prevent the identified vulnerability scenarios.

## Evidence

All 4999 tests pass (0 failed, 6 ignored). The integrity assertions run
inline during every merge operation and would throw immediately if a dangling
reference were produced.

## Test Plan

New test file: `test/compact/ParallelMergeCornerCases.ts` with 7 tests:
- Bridge neuron with typed synapse is not merged (IDENTITY and general)
- Kept neuron's source is also merged elsewhere — no conflicts
- Duplicate synapse from redirect is prevented (same inbound source)
- Neuron becomes bridge after zero-weight pruning context
- COMPLEMENT bridge with extra typed synapse is excluded
- Integrity assertion verification for IDENTITY merge
- Integrity assertion verification for COMPLEMENT merge

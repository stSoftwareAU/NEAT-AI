## Summary

Add `assertValidSynapseReferences()` validation utility that checks all synapse
references in a `CreatureExport` point to neurons that actually exist. This is a
foundational debugging tool for preventing and diagnosing the invalid creature
bug described in #2011. Closes #2012.

The function builds a set of valid neuron IDs from the neurons array plus input
neuron IDs (0 to inputCount-1), then verifies every synapse's `fromId` and
`toId` exist in that set. On failure it throws with diagnostic information
including the offending synapse, the missing neuron ID, and all valid IDs.

## Evidence

- 9 unit tests cover: valid export, dangling fromId, dangling toId, input neuron
  IDs as valid sources, empty synapses, empty neurons with synapses, context
  string in errors, output neuron IDs as valid targets, and constant neurons.
- All 4986 tests pass via `./quality.sh`.

## Test Plan

- `test/architecture/AssertValidSynapseReferences.ts`:
  - Valid export passes without throwing
  - Dangling `fromId` throws with descriptive error mentioning the neuron ID
  - Dangling `toId` throws with descriptive error mentioning the neuron ID
  - Input neuron IDs (0 to inputCount-1) are treated as valid sources
  - Empty synapses array passes
  - Empty neurons array with synapses referencing non-existent neurons throws
  - Context string is included in error messages
  - Output neuron IDs are valid targets
  - Constant neuron IDs are valid

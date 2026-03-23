## Summary

Implement creature JSON deserialisation in Rust for the `neat-core` shared library crate. This adds the ability to parse `CreatureExport` JSON (the TypeScript creature format) directly in Rust and convert it into a `CompiledNetwork` for efficient activation. Closes #1965.

### Changes

- Added `serde` and `serde_json` dependencies to `neat-core`
- Created `neat-core/src/creature.rs` with:
  - `CreatureExport`, `NeuronExport`, `SynapseExport` structs with serde `Deserialize` derives
  - `parse_squash_name()` mapping all 38 squash function names (including aliases) to `SquashType` enum values
  - `parse_synapse_type()` mapping synapse type strings to `SynapseType` enum values
  - `parse_creature_json()` for JSON string parsing
  - `compile_creature()` converting `CreatureExport` to `CompiledNetwork` with UUID-to-index resolution
- Registered the module in `lib.rs` and re-exported all public types and functions

### Supported features

- All 38 squash function types including 4 aliases (CLIPPED, RELU, INVERSE, SINUSOID)
- All synapse types: standard, positive, negative, condition
- All neuron types: input (implicit), hidden, output, constant
- Aggregate functions: MINIMUM, MAXIMUM, IF, HYPOT, HYPOTv2, MEAN
- Extra JSON fields (forwardOnly, tags, frozen, etc.) are gracefully ignored

## Evidence

All 192 `neat-core` unit tests pass (22 new creature tests + 170 existing). Full quality gate passes with all 4870 Deno tests green.

## Test Plan

- `test_parse_squash_names` — verifies all 38 squash names + 4 aliases
- `test_parse_squash_name_unknown` — unknown name returns error
- `test_parse_synapse_types` — all synapse type strings including unknown
- `test_parse_minimal_creature_json` — basic JSON parsing
- `test_compile_minimal_creature` — end-to-end: parse, compile, activate, verify output
- `test_compile_creature_with_hidden_neurons` — hidden neuron with TANH squash
- `test_compile_creature_with_constant_neuron` — constant neuron outputs bias
- `test_compile_creature_no_hidden_neurons` — direct input-to-output network
- `test_compile_creature_with_if_neuron` — IF aggregate with condition/positive/negative branches
- `test_compile_creature_all_squash_types` — every non-aggregate squash produces correct output
- `test_compile_creature_synapse_types` — positive synapse type correctly stored
- `test_compile_creature_default_squash` — omitted squash defaults to IDENTITY
- `test_compile_creature_disconnected_neuron` — neuron with no incoming synapses
- `test_compile_creature_output_count_mismatch` — validation error for wrong output count
- `test_compile_creature_unknown_source_uuid` — validation error for unknown UUID
- `test_compile_creature_with_semantic_version` — optional field parsing
- `test_compile_creature_with_aggregate_minimum` — MINIMUM aggregate function
- `test_compile_creature_with_aggregate_maximum` — MAXIMUM aggregate function
- `test_parse_real_creature_json` — realistic multi-layer creature with IF neuron
- `test_compile_creature_large_network` — 5 inputs, 10 hidden, 2 outputs (70 synapses)
- `test_compile_creature_single_output_no_synapses` — output with bias only
- `test_parse_creature_json_ignores_extra_fields` — extra fields gracefully ignored
- `test_compile_creature_deprecated_squash` — HYPOT, HYPOTv2, MEAN deprecated types

## Summary

Extended `CRISPR.editAliases()` to rewrite `toUUID` in synapses and `uuid` in
neuron definitions when a matching alias key is found, enabling full source and
destination UUID remapping for flexible gene reuse. Closes #1667.

## Evidence

This is a backend/logic change with no visual output. All 4364 tests pass
including the 3 new tests and the existing `editAliases` test.

## Test Plan

- `editAliases rewrites toUUID` — alias applied to `toUUID` synapse field
- `editAliases rewrites neuron uuid` — alias applied to neuron `uuid` field
- `editAliases no-op when alias matches nothing` — unmatched alias leaves DNA unchanged
- Existing `editAliases` test continues to pass unchanged

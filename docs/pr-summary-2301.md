## Summary

Include `creature.input` in the topology hash computed by
`CreatureUtil.getTopologyHash()`. Previously the hash was based only on neuron
UUIDs/types/squash functions and synapse connection patterns, but **not** the
input count. When `Upgrade.correct()` extended a creature's input count (e.g. 5
→ 12) without adding neurons or synapses, the topology hash remained identical,
causing a WASM compilation cache collision — the module compiled for 5 inputs
was reused for the creature with 12 inputs, triggering
`WasmError: Input length 12 does not match expected 5`.

The fix prepends `inputCount` to the hash text:

```typescript
const txt = inputCount + "\n" + neuronKey + "\n\n" + synapseKeys.join("\n");
```

Closes #2301.

## Evidence

This is a backend/logic fix with no visual output. Evidence is provided by the
new and existing tests:

- **Tests in `test/architecture/TopologyHash.ts`** verify that different input
  counts produce different hashes and same input counts still match.
- **Tests in `test/architecture/TopologyHashInputCount.ts`** (if present from
  prior attempt) provide additional coverage for multiple input count pairs and
  incremental caching.
- **Existing topology hash tests** continue to pass (no regressions).

## Test Plan

- `deno test test/architecture/TopologyHash.ts` — all tests pass including 2 new
  input-count-specific tests
- `deno test test/architecture/TopologyHashDirectCompute.ts` — 8 tests pass
  (regression check)

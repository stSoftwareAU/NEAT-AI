## Summary

Add UUID-based alias support to `CRISPR.editAliases()`. The method now accepts
both numeric ID alias maps (`Record<number, number>`) and UUID-based alias maps
(`Record<string, string>`), resolving labels in `neuron.uuid`,
`synapse.fromUUID`, and `synapse.toUUID` fields. This allows GRQ and other
consumers to use the standard NEAT-AI API for UUID alias resolution instead of
maintaining custom workarounds. Closes #2156.

### Changes

- **`src/reconstruct/CRISPR.ts`**: Extended `CrisprInterface` with `uuid` field
  on neurons and `fromUUID`/`toUUID` fields on synapses. Updated `editAliases()`
  to detect alias map type and resolve UUID-based aliases against the new
  fields.
- **`test/CRISPR/UuidAliases.ts`**: New test file with 6 tests covering UUID
  alias resolution for `fromUUID`, `toUUID`, `neuron.uuid`, no-op behaviour,
  backward compatibility with numeric aliases, and immutability of original DNA.

## Evidence

All 5228 tests pass (0 failed, 38 ignored). The 4 existing `editAliases` tests
in `test/CRISPR/Aliases.ts` continue to pass unchanged, confirming backward
compatibility.

## Test Plan

- `test/CRISPR/UuidAliases.ts` — 6 new tests:
  - `editAliases resolves UUID aliases in synapse fromUUID`
  - `editAliases resolves UUID aliases in synapse toUUID`
  - `editAliases resolves UUID aliases in neuron uuid`
  - `editAliases UUID aliases no-op when nothing matches`
  - `editAliases numeric aliases still work (backward compatible)`
  - `editAliases does not mutate original DNA`
- `test/CRISPR/Aliases.ts` — 4 existing tests unchanged and passing

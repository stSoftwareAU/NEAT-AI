## Summary

Add runtime schema validation for CrisprInterface DNA input via a new `validateDNA()` function. Previously, malformed DNA (missing `weight`, invalid `type`, unknown `mode`, missing `id`) only failed deep inside `insert()`/`append()` with opaque `assert()` calls that were silently swallowed in `cleaveDNA()`. Now, `validateDNA()` is called at the start of `cleaveDNA()` and provides clear, descriptive error messages indicating exactly which field is invalid.

Closes #1666.

## Changes

- **`src/reconstruct/validateDNA.ts`** (new): Exported `validateDNA()` function that validates DNA structure before processing — checks `id` (non-empty string), `mode` (insert/append, with undefined defaulting to append for backwards compatibility), neuron fields (`type`, `squash`, `bias`), synapse `weight` (finite number), and insert-mode constraints (no static indices, no relative indices, no output neurons). Accepts both current (`neurons`/`synapses`) and legacy (`nodes`/`connections`) field names.
- **`src/reconstruct/CRISPR.ts`**: Added `validateDNA(dna)` call at the start of `cleaveDNA()`.
- **`mod.ts`**: Exported `validateDNA` from the public API.

## Evidence

This is a backend/library change with no UI. Verified by:
- All 19 new validation tests pass
- All 4361 existing tests continue to pass
- `./quality.sh` passes cleanly

## Test Plan

Added `test/CRISPR/ValidateDNA.ts` with 19 tests covering:
- Missing `id` / empty `id`
- Invalid `mode` / missing `mode` (defaults to append)
- Missing `weight` / non-finite `weight`
- Insert-mode DNA with static `from`/`to` indices
- Insert-mode DNA with `fromRelative`/`toRelative`
- Insert-mode DNA with output neurons
- Neuron missing `type` / `squash` / `bias`
- Valid append-mode and insert-mode DNA (no throw)
- Legacy `nodes`/`connections` field names
- Null input / missing `synapses`

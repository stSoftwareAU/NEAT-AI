## Summary

Explicitly dispose replaced population creatures after each generation to free
WASM heap allocations deterministically. Closes #1568.

Previously, when `evolve()` replaced `this.population` with a new generation,
old `Creature` objects went out of scope but their `cachedWasmActivation` could
linger in the GC queue. WASM heap allocations were only freed when the
`FinalizationRegistry` callback fired, which is non-deterministic and may be
delayed under memory pressure.

Now, before returning from `evolve()`, the old population is compared against
the new population using object identity. Creatures not carried forward (i.e.
not elitists) are explicitly disposed, freeing WASM heap allocations, clearing
caches, and nulling internal references immediately.

## Changes

- **`src/NEAT/Neat.ts`**: After assembling the new population and running
  de-duplication, iterate over the old population and call `dispose()` on
  creatures that are not present in the new population.
- **`test/NEAT/NeatDisposeReplacedPopulation.ts`**: New test file with 4 tests
  verifying disposal behaviour.

## Evidence

This is a backend/memory-management change with no visual output. Evidence is
provided by the unit tests:

- All 4253 tests pass (including the 4 new disposal tests)
- Quality checks pass cleanly

## Test Plan

- `evolve: old population creatures are disposed after replacement` — verifies
  that replaced creatures have empty neurons/synapses arrays and no cached WASM
- `evolve: elitists are not disposed when carried forward` — verifies that
  carried-forward creatures remain intact
- `evolve: WASM is freed deterministically on replaced creatures` — verifies
  that `cachedWasmActivation` is `undefined` on all replaced creatures
- `evolve: multiple generations dispose correctly each time` — verifies disposal
  works correctly across 3 sequential generations

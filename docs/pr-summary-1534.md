## Summary

Replace O(n) linear scan with O(1) doubly-linked list + Map LRU in `WasmCreatureActivationLRU.ts`. Closes #1534.

The previous implementation scanned all entries linearly to find the oldest for eviction, and allocated a new `{ ref, lastAccess }` object on every call — even for existing entries. This sits in the activation hot path (called on every forward pass), scaling with population size × samples per generation.

The new implementation uses a standard doubly-linked list + Map LRU pattern:
- **Lookup**: O(1) via `Map<number, LruNode>`
- **Move to head** (on re-access): O(1) pointer swap, no allocation
- **Evict tail** (oldest): O(1) — just remove the tail node
- **Existing entries**: No new `WeakRef` allocation; node is moved in place

## Evidence — Benchmark Results

| Benchmark | Before | After | Speedup |
|---|---|---|---|
| noteUse (existing entry, 512 creatures) | 81.7 µs | 32.2 µs | **2.5× faster** |
| noteUse (with eviction at cap 256) | 558.7 µs | 72.5 µs | **7.7× faster** |
| bulk evict 256 of 512 | 375.0 µs | 35.2 µs | **10.7× faster** |

All measurements on Apple M4 Pro, Deno 2.6.8.

## Test Plan

- All 11 existing `WasmCreatureActivationLRU` tests pass unchanged
- All 4140 project tests pass (`./quality.sh` clean)
- New benchmark: `bench/WasmCreatureActivationLRU.ts`

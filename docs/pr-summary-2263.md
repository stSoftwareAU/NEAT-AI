## Summary

Add proactive pre-fitness memory monitoring to reduce GC pressure during fitness evaluation. Closes #2263.

Previously, heap memory was only checked **after** the fitness, breeding, and result processing phases. If heap pressure built up during the previous generation, the next fitness phase started under memory pressure, triggering reactive per-creature eviction attempts inside `CreatureActivation.ts` (the 3-tier retry pattern with `evictOldestWasmCreatureActivations(64)`).

This change adds a `checkMemoryAndEvict()` call **before** the fitness evaluation phase, proactively clearing WASM caches when the heap is under pressure. This gives the fitness phase more memory headroom and reduces scattered GC pauses during `fitnessMs`.

### Changes

- **`src/NEAT/NeatEvolution.ts`**: Added pre-fitness `checkMemoryAndEvict()` call with `memory_pressure` event emission. Both pre- and post-fitness eviction times are accumulated into `memoryEvictionMs`.
- **`src/config/TrainingEvent.ts`**: Added optional `memoryEvictionMs` field to `GenerationPhaseTiming` for tracking memory monitoring overhead.
- **`bench/PreFitnessMemoryEviction.ts`**: New benchmark comparing reactive-only vs proactive eviction under constrained cache scenarios.
- **`test/NEAT/PreFitnessMemoryEviction.ts`**: 7 tests verifying pre-fitness eviction behaviour at normal, warning, and critical pressure levels.

## Evidence

### Benchmark Results

```
CPU: Apple M4
Runtime: Deno 2.7.12 (aarch64-apple-darwin)

group memory-pressure
| Fitness eval - reactive eviction only (baseline)  | 2.0 ms | 510.5 iter/s |
| Fitness eval - proactive pre-fitness eviction      | 1.9 ms | 530.8 iter/s |

summary: baseline is 1.04x slower than proactive pre-fitness eviction

group cache-stats
| Cache stats - adequate cache           | 1.79x faster than constrained cache |
```

Key findings:
- **4% improvement** in single-generation fitness evaluation with proactive eviction
- **Adequate cache sizing** (100 entries) is **1.79x faster** than constrained (5 entries), validating that cache sizing is critical
- Multi-generation sustained pressure is within noise (~2%), as both approaches reach the same equilibrium

### Test Results

All 5742 tests pass, 0 failed, 3 ignored. No regressions.

## Test Plan

- Added `test/NEAT/PreFitnessMemoryEviction.ts` with 7 tests:
  - Pre-fitness eviction at warning level halves activation cache
  - Pre-fitness eviction at critical level clears caches
  - No eviction at normal pressure preserves cache caps
  - Consecutive pre-fitness checks progressively reduce cache cap
  - `memoryEvictionMs` field is optional in `GenerationPhaseTiming`
  - Pre-fitness then post-fitness eviction accumulates correctly
  - `MemoryCheckResult` contains valid heap diagnostics
- All existing `test/NEAT/MemoryMonitor.ts` tests continue to pass (18 tests)
- Benchmark: `deno bench --allow-all bench/PreFitnessMemoryEviction.ts`

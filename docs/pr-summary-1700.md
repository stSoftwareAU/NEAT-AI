## Summary

Add comprehensive performance tuning guide for large-scale training runs.
Closes #1700.

Created `docs/PERFORMANCE_TUNING.md` covering all configurable performance
parameters with practical recommendations:

- **WASM cache tuning**: `maxCachedActivations` and `compilationCacheSize` sizing
  guidance
- **Distance cache tuning**: sizing for different population sizes with benchmark
  data
- **Thread pool configuration**: thread count, memory-based thread capping
- **Memory management**: heap monitoring thresholds, cache diagnostics with
  `getCacheStats()`
- **Population size and selection pressure**: trade-off tables, adaptive mutation
  thresholds
- **WASM activation**: when WASM excels vs the serialisation wall
- **Discovery and GPU acceleration**: when to enable/disable, configuration
  parameters
- **Memetic evolution**: backpropagation parameters, fine-tune population sizing
- **Scaling patterns**: single-machine thread pool sizing, multi-machine island
  model, data set batching strategies
- **Tuning recipes**: prototyping, production, and maximum exploration
  configurations
- **Diagnostics and monitoring**: cache stats, worker pool stats, memory pressure
  detection

Key concepts (LRU cache, work-stealing, island model, memetic evolution) are
explained at first use. Australian English throughout.

Cross-referenced from README.md documentation section and AGENTS.md layout.

## Evidence

This is a documentation-only change with no code modifications. Verified by
running the full quality gate (`./quality.sh`) — all 4512 tests pass, linting
and type-checking clean.

## Test Plan

- No code changes; no new tests required
- Existing test suite (4512 tests) passes without modification
- Documentation reviewed for accuracy against actual config defaults and types
  in `src/config/`

## Summary

Add proactive heap memory monitoring and graduated cache eviction to prevent OOM
during long-running evolution. `Deno.memoryUsage()` is checked once per generation
after old population disposal. When heap usage exceeds configurable thresholds,
WASM activation and compilation caches are proactively evicted before OOM occurs.

Closes #1565.

### What changed

- **`src/config/MemoryConfig.ts`** — New config type with `enabled`, `warningThreshold`
  (default 70%), and `criticalThreshold` (default 85%) fields
- **`src/NEAT/MemoryMonitor.ts`** — Memory monitoring module with graduated responses:
  - **Warning level** (≥70%): Halves activation cache cap, evicts oldest entries
  - **Critical level** (≥85%): Clears all WASM caches, resets to minimum caps
  - Logs heap usage (used/total/percentage) at each generation
- **`src/NEAT/Neat.ts`** — Calls `checkMemoryAndEvict()` and `logMemoryUsage()` once
  per generation at the end of `evolve()`
- **`src/config/NeatArguments.ts`** — Added `memory: RequiredMemoryConfig` field
- **`src/config/NeatOptions.ts`** — Added `memory?: MemoryConfig` partial override
  (with `CoerceNumeric<>` support for CLI)
- **`src/config/NeatConfig.ts`** — Parses memory config with cross-field validation
  (criticalThreshold ≥ warningThreshold)

### Acceptance criteria

- [x] `Deno.memoryUsage()` is checked at least once per generation in the training loop
- [x] Configurable threshold triggers proactive cache eviction before OOM
- [x] Memory usage is logged at each generation (heap used / heap total)
- [x] Graduated response (warning vs critical) with different eviction strategies
- [x] Unit tests cover threshold detection and eviction triggering
- [x] Australian English used throughout

## Evidence

This is a backend/CLI enhancement with no web interface. Evidence is provided via
passing tests and the memory monitoring output visible in integration test logs:

```
[MemoryMonitor] Heap: 467 MB / 679 MB (68.7%)
[MemoryMonitor] Warning-level response: reduced activation cache cap from 50 to 25, evicted 12 entries
[MemoryMonitor] Heap: 489 MB / 679 MB (71.9%) [WARNING]
```

## Test Plan

- Added `test/NEAT/MemoryMonitor.ts` — 17 tests covering:
  - `determinePressureLevel()` for normal/warning/critical with default and custom thresholds
  - `applyWarningResponse()` halves activation cache cap
  - `applyCriticalResponse()` clears all caches aggressively
  - `checkMemoryAndEvict()` with fake memory providers at various usage levels
  - `checkMemoryAndEvict()` skips eviction when disabled
  - Zero heapTotal edge case
  - `logMemoryUsage()` formatting and pressure level tags
- Added 5 tests to `test/NEAT/NeatConfigCoverage.ts`:
  - Memory config defaults
  - Partial override
  - Full override
  - Cross-field validation (criticalThreshold < warningThreshold throws)
  - Out-of-range warningThreshold throws
- All 4275 tests pass via `./quality.sh`

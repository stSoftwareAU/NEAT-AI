## Summary

Add structured event logging for key training lifecycle events via an optional `onTrainingEvent` callback in `NeatOptions`. Closes #1615.

When registered, the callback receives typed, discriminated-union events for:
- **generation_complete**: generation number, best/average fitness, population size, elapsed time
- **plateau_detected**: stagnation count, plateau threshold, improvement rate, mutation multiplier
- **discovery_complete**: outcome (improved/no_change/timeout), candidate count, elapsed time
- **memory_pressure**: heap used/limit, eviction status, pressure level
- **species_adjusted**: species count, compatibility threshold

All events include ISO-8601 timestamps. The callback is fire-and-forget with zero cost when not provided. Exceptions thrown by the callback are silently caught to avoid disrupting training.

## Evidence

This is a backend/library enhancement with no visual output. Verified through:
- All 4261 tests pass (7 new + 4254 existing)
- `./quality.sh` passes cleanly (lint, format, type-check, tests)

## Test Plan

Added `test/config/TrainingEvent.ts` with 7 tests:
- `generation_complete` events are emitted with correct structure
- Generation numbers are sequential (1-based)
- No events when callback not provided (backward compatibility)
- Callback exceptions do not disrupt training
- `plateau_detected` events emitted when plateau detected
- All events include required metadata fields (kind, timestamp)
- `species_adjusted` events are emitted with correct structure

## Summary

Cache the `forwardOnlyGuaranteed` flag instead of parsing `semanticVersion` on every activation call. Closes #1535.

Previously, `activateWasm()`, `activateEphemeral()`, and `evaluateDir()` each parsed the creature's semantic version string (`split(".")` + `parseInt`) on every call to determine the `forwardOnlyGuaranteed` flag. Since `semanticVersion` does not change after construction, this was unnecessary repeated work in the hot path.

Changes:
- Added `cachedMajorVersion` property to `Creature`, computed once during construction and updated in `loadFrom()` during deserialisation
- Added `forwardOnlyGuaranteed` getter that derives the flag from `cachedMajorVersion` and `forwardOnly` without any string parsing
- Replaced all 4 inline `semanticVersion.split(".")` computations in `CreatureActivation.ts` with reads of the cached getter
- The getter correctly reflects mutations to `forwardOnly` since it reads the current value on each access

## Evidence

This is a backend/performance change with no visual output. Benchmark result:

```
bench/Activate.ts
| benchmark   | time/iter (avg) |        iter/s |      (min … max)      |      p75 |      p99 |     p995 |
| ----------- | --------------- | ------------- | --------------------- | -------- | -------- | -------- |
| Activate    |          6.5 ms |         152.7 | (  6.2 ms …   7.8 ms) |   6.7 ms |   7.8 ms |   7.8 ms |
```

The change eliminates per-activation string parsing overhead. The improvement is primarily in reduced allocation pressure (no `split()` array creation per call) rather than wall-clock time, as the parsing was already fast relative to WASM activation.

## Test Plan

- Added `test/creature/ForwardOnlyGuaranteed.ts` with 9 tests covering:
  - v4+ forward-only creature returns `true`
  - v3 creature returns `false`
  - Default version (0.0.1) returns `false`
  - v5+ forward-only creature returns `true`
  - Preserved through `fromJSON()` round-trip (both true and false)
  - Preserved through `shallowClone()` (both true and false)
  - Invalid version string returns `false`
- All 4149 existing tests pass

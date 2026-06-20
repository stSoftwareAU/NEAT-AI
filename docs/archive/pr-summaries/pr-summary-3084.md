## Summary

Made breed `DistanceCache` eviction **O(1)** instead of **O(cacheSize)**. The
cache previously found the least-recently-used (LRU) entry by scanning **every**
entry on each eviction, and `setCachedDistance` runs `evictIfNeeded()` on every
insert — so once the cache saturated (up to `DEFAULT_MAX_SIZE = 10_000`), each
insert scanned the whole cache. Because speciation is an O(N²) all-pairs pass,
this scan multiplied the hottest population-level loop.

JavaScript `Map` already preserves insertion order, so a true O(1) LRU needs no
`lastAccess` bookkeeping:

- **Hit** (`getCachedDistance`): `delete` then `set` the key to move it to the
  most-recently-used (last) position.
- **Insert** (`setCachedDistance`): `delete` then `set` so an existing key also
  refreshes to the last position.
- **Eviction** (`evictIfNeeded`): remove the first key via
  `cache.keys().next().value` — the least-recently-used entry.

This removes the per-entry `lastAccess` field and the global `accessCounter`,
and shrinks each cache value from an object to a bare `number`. Hit/miss/eviction
statistics (`getDistanceCacheStats`) are unchanged, and eviction still strictly
bounds the cache at `maxSize`.

Closes #3084.

## Evidence

Backend/CLI change — no web interface to screenshot. Verified by tests and a
dedicated benchmark (`bench/DistanceCacheEviction.ts`) that drives the write path
well past `maxSize` so nearly every insert evicts, isolating the eviction cost.

### Benchmark: eviction-heavy writes (40 000 inserts into a 2 000-entry cache)

| Version            | time/iter (avg) | iter/s |
| ------------------ | --------------- | ------ |
| Before (O(n) scan) | 248.9 ms        | 4.0    |
| After (O(1) LRU)   | 21.7 ms         | 46.1   |

≈ **11.5× faster** on the saturated write path (Apple M4 Pro, Deno 2.8.3).

```mermaid
flowchart LR
    subgraph Before["Before — O(cacheSize)"]
        I1[insert] --> E1[evictIfNeeded]
        E1 --> S1[scan ALL entries\nfor min lastAccess]
        S1 --> D1[delete oldest]
    end
    subgraph After["After — O(1)"]
        I2[insert: delete+set\nmove to tail] --> E2[evictIfNeeded]
        E2 --> H2[keys().next\nfirst = LRU]
        H2 --> D2[delete first]
    end
```

## Test Plan

All tests in `test/breed/DistanceCache.ts` pass (14 total). Added three new
"what" tests guarding the insertion-order LRU semantics:

- `DistanceCache - a hit refreshes recency so the unaccessed entry is evicted` —
  a hit on the oldest entry makes it most-recently-used, so the next insert
  evicts the now-oldest *unaccessed* entry.
- `DistanceCache - eviction strictly bounds the cache at maxSize` — inserting 100
  distinct entries into a 5-entry cache keeps size at 5, records 95 evictions,
  and retains exactly the last 5 inserts.
- `DistanceCache - shrinking maxSize evicts oldest entries immediately` —
  lowering `maxSize` drops the oldest entries down to the new bound, retaining
  the most-recently inserted.

Existing tests (stores/retrieves, canonical key order, hit/miss stats, eviction
recency, `geneticCompatibility` cache parity) continue to pass unchanged,
confirming hit-rate parity and correct statistics.

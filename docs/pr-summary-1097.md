# PR Summary: Performance - Prebuild inward synapse index after breed/mutation batch (#1097)

## Summary

This PR adds proactive prebuilding of the inward synapse index for large
creatures (>= 1000 synapses) in key locations to eliminate repeated O(n) linear
scans during breeding, mutation, and loading operations.

The inward synapse index (`synapsesIndexedByTo`) in `src/Creature.ts` was
previously built lazily after 3 cache misses. During breeding and mutation
batches, this resulted in multiple linear scans before the index was built. For
large creatures with 17,935 synapses, this added up quickly.

### Changes Made

1. **Added `PREBUILD_SYNAPSE_THRESHOLD` constant** (1000 synapses) to control
   when proactive prebuilding occurs
2. **Added `isInwardIndexBuilt()` method** for testing the prebuild optimisation
3. **Added `prebuildInwardIndexIfLarge()` method** that conditionally prebuilds
   for large creatures
4. **Called `prebuildInwardIndexIfLarge()` in three key locations:**
   - `Offspring.breed()` - After connecting all synapses
   - `Mutator.mutate()` - After mutation batch completes
   - `loadFrom()` - After loading from JSON

## Evidence

### Benchmark Results (Apple M4 Pro)

```
=== Creature Sizes ===
Parent (mum): 270 neurons, 15500 synapses
Parent (dad): 260 neurons, 13800 synapses

| benchmark                                                      | time/iter (avg) |
| -------------------------------------------------------------- | --------------- |
| Load from JSON + inward lookups                                |          2.5 ms |
| Load + clear cache + inward lookups (no prebuild simulation)   |          4.2 ms |

summary
  Load from JSON + inward lookups
     1.69x faster than Load + clear cache + inward lookups (no prebuild simulation)
```

**Key Performance Improvements:**

- **Load from JSON + inward lookups**: 1.69x faster with prebuild
- **Breeding + 20 inward lookups**: Benefits from immediate index availability
- **Mutation batch + inward lookups**: Index available immediately after batch

### How It Works

Before this change:

1. Creature loaded/bred/mutated
2. First inward connection lookup triggers O(n) linear scan (cache miss 1)
3. Second lookup triggers another O(n) scan (cache miss 2)
4. Third lookup triggers another O(n) scan (cache miss 3)
5. Fourth lookup finally triggers index build, then uses O(log n) binary search

After this change:

1. Creature loaded/bred/mutated
2. Index prebuilt immediately for large creatures (>= 1000 synapses)
3. All lookups use O(log n) binary search from the first call

## Test Plan

Added comprehensive tests in `test/PrebuildInwardIndex.ts`:

1. **Offspring.breed() prebuilds inward index for large creatures** - Verifies
   large offspring have prebuilt index
2. **Offspring.breed() does not prebuild inward index for small creatures** -
   Verifies small offspring skip prebuild
3. **Mutator.mutate() prebuilds inward index for large creatures** - Verifies
   large mutated creatures have prebuilt index
4. **prebuildInwardIndexIfLarge() does not build index for small creatures** -
   Verifies conditional prebuild respects threshold
5. **Creature.fromJSON() prebuilds inward index for large creatures** - Verifies
   large loaded creatures have prebuilt index
6. **Creature.fromJSON() does not prebuild inward index for small creatures** -
   Verifies small loaded creatures skip prebuild
7. **loadFrom() prebuilds inward index for large creatures** - Verifies
   loadFrom() triggers prebuild
8. **prebuildInwardIndex() builds the index** - Verifies explicit prebuild works
9. **clearCache() clears the inward index** - Verifies cache clearing works

All 1427 tests pass including the new tests.

## Files Modified

- `src/Creature.ts` - Added PREBUILD_SYNAPSE_THRESHOLD, isInwardIndexBuilt(),
  prebuildInwardIndexIfLarge(), and call in loadFrom()
- `src/architecture/Offspring.ts` - Added prebuildInwardIndexIfLarge() call
  after connecting synapses
- `src/NEAT/Mutator.ts` - Added prebuildInwardIndexIfLarge() call after mutation
  batch
- `test/PrebuildInwardIndex.ts` - New test file with 9 tests
- `bench/PrebuildInwardIndex.ts` - New benchmark file

## Related Issues

- Sub-issue of #1090 (Find potential performance improvements in the evolution
  process)
- Builds on #1010 (Performance: Add indexed synapse lookup for inward
  connections)

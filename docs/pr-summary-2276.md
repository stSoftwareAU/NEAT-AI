## Summary

Replace the expensive `exportJSONWithRuntimeIds()` → `Creature.fromJSON()`
round-trip in `evolveDir()` bestCreature tracking with `shallowClone()`,
achieving a 5–7x speedup. Closes #2276.

### bestCreature creation (CreatureTraining.ts) — **Optimised**

The `evolveDir` loop clones the fittest creature each time a new best score is
found. The old pattern serialised to JSON and deserialised back:

```typescript
bestCreature = CreatureClass.fromJSON(exportJSONWithRuntimeIds(fittest));
bestCreature.uuid = fittest.uuid;
bestCreature.score = bestScore;
```

Replaced with `shallowClone()` which directly copies neurons and synapses
in-memory:

```typescript
bestCreature = fittest.shallowClone() as InstanceType<typeof CreatureClass>;
bestCreature.score = bestScore;
```

### processCompletedResults (NeatEvolution.ts) — **Negative result (no change)**

The `fromJSON()` calls in `processCompletedResults` reconstruct creatures from
`CreatureExport` objects received from worker threads. There is no in-memory
`Creature` instance to clone from, so `shallowClone()` is not applicable. The
existing `debug=false` path already skips validation, which is optimal for
trusted worker output.

## Evidence

### Benchmark results (bench/BestCreatureClone.ts)

| Creature Size | Neurons | Synapses | JSON Round-trip | shallowClone | Speedup   |
| ------------- | ------- | -------- | --------------- | ------------ | --------- |
| Small         | 35      | 300      | 47.9 µs         | 9.0 µs       | **5.31x** |
| Medium        | 210     | 10,500   | 2.2 ms          | 292.1 µs     | **7.42x** |
| Large         | 470     | 46,000   | 14.1 ms         | 2.0 ms       | **7.13x** |

### processCompletedResults benchmark (bench/ProcessCompletedResultsFromJSON.ts)

Documents that `fromJSON(debug=false)` is already 1.3–2.1x faster than
`fromJSON(debug=true)`. No further optimisation possible without an in-memory
Creature to clone.

### Verification

Tests confirm `shallowClone()` produces functionally identical creatures to the
old JSON round-trip pattern — matching runtime IDs, neuron UUIDs, synapse
structure, tags, scores, and activation outputs.

## Test Plan

- Added `test/creature/ShallowCloneRuntimeIds.ts` (3 tests) verifying:
  - `shallowClone()` preserves runtime IDs equivalent to
    `exportJSONWithRuntimeIds + fromJSON`
  - Multi-layer creature runtime ID and activation output equivalence
  - Semantic version and `forwardOnly` flag preservation
- All 5,751 existing tests pass (0 failures)
- Added `bench/BestCreatureClone.ts` — benchmarks bestCreature clone patterns
- Added `bench/ProcessCompletedResultsFromJSON.ts` — documents
  processCompletedResults findings

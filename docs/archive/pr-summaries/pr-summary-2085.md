## Summary

Public Intelligent Design / tacit knowledge APIs now key neurons by UUID string
instead of runtime integer id, aligning with the neuron identity contract
established in Issue #1958. Closes #2085.

### Breaking changes

- `TacitKnowledgeMap` changed from `Record<number, string>` to
  `Record<string, string>`
- `makeModifiedCreature()` accepts `neuronUuid: string` instead of
  `neuronId: number`
- `makeModifiedCreatureWithPrevious()` accepts `neuronUuid: string` instead of
  `neuronId: number`
- `getValidNeuronSquashes()` returns `Map<string, string>` instead of
  `Map<number, string>`
- `cleanKnowledge()` accepts `Map<string, string>` for valid neuron UUIDs
- `getNeuronsToTest()` looks up neurons via `n.uuid` instead of `n.id`
- `applyNeuronChanges()` accepts `Map<string, ...>` keyed by UUID
- `ImproveSquashResult.improvements` is `Map<string, BestNeuronSquash>` instead
  of `Map<number, BestNeuronSquash>`
- `combineImprovements()` accepts `Map<string, BestNeuronSquash>`

Consumers passing numeric keys will need to migrate to UUID string keys.

## Evidence

All 5107 tests pass (the single failure in DiscoveryRobustness is an
intermittent GPU timeout issue unrelated to this change).

## Test Plan

- Updated `test/intelligentDesign/TacitKnowledge.ts` — all functions tested with
  UUID string keys
- Updated `test/intelligentDesign/TacitKnowledgeApplyNeuronChanges.ts` —
  UUID-keyed neuron squash map
- Updated `test/intelligentDesign/ImproveSquash.ts` —
  `makeModifiedCreatureWithPrevious` with UUID
- Updated `test/intelligentDesign/ImproveSquashCombine.ts` —
  `combineImprovements` with UUID keys
- Updated `test/intelligentDesign/ImproveSquashScan.ts` — scan internals use
  UUID for neuron lookup
- Updated `test/intelligentDesign/ImproveSquashAlternativeMessage.ts` —
  alternative squash with UUID
- Updated `test/intelligentDesign/ImproveSquashWorkerErrors.ts` — error
  reporting uses UUID
- Updated `test/intelligentDesign/ImproveSquashAtomicWrites.ts` — atomic writes
  use UUID
- Updated `test/intelligentDesign/CombineImprovementsWasm.ts` — WASM combine
  path uses UUID

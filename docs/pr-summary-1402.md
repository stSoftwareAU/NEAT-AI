## Summary

Reduce unsafe type assertions (`as any`, `as unknown`) across the codebase by
introducing proper type declarations, type guards, interfaces, and discriminated
union narrowing. Closes #1402.

**Before:** 32+ unsafe casts scattered across 15 files, including `as any`,
untyped `Function`, and redundant local type aliases.

**After:** Only 4 documented boundary casts remain (2 worker `self` casts, 1
legacy JSON `Record` cast in `Creature.fromJSON`, 1 legacy JSON `Record` cast in
`Upgrade.CRISPR`), all with typed targets and explanatory comments. All `as any`
casts and `ban-types` lint suppressions are eliminated.

### Changes by category

**Global type declarations** (`src/globals.d.ts`):

- New `declare global` augmentation for `DEBUG` and
  `__NEAT_AI_SKIP_WASM_AUTO_INIT`
- Eliminates 4 `as any`/`as unknown` casts in worker files, `Creature.ts`, and
  `NeatConfig.ts`

**Discriminated union narrowing** (`ApplyCoordinatedStructuralCandidate.ts`,
`DiscoveryReplayRunner.ts`):

- Replaced 16 unsafe casts (7 `as string` + 7 `as unknown as XxxOp` pairs + 2
  more) with a `switch` statement on the discriminant `op.type`
- Deleted 8 redundant local type aliases that duplicated the imported
  `CoordinatedStructuralOperation` union members

**Type guards** (`src/methods/activations/TypeGuards.ts`):

- New `hasUnSquash()` and `hasSimplifyBias()` type guards
- Replaces duck-typing casts in `ActivationMethods.ts`, `Simplify.ts`, and
  `SquashType.ts`
- `wasmAliasName` was already on `AbstractActivationInterface` so the cast in
  `SquashType.ts` simply dropped

**Interface extraction** (`src/propagate/sparse/SparseConfigLike.ts`):

- New structural interface for the public contract of `SparseConfig`
- `SparseConfig` now explicitly implements `SparseConfigLike`
- `Creature.activateAndTrace()` accepts `SparseConfigLike`, eliminating the
  duck-typed cast in `DiscoverStructure.ts`

**Interface widening** (`DiscoveryRunner.ts`, `ImproveSquash.ts`):

- Added optional `waitUntilReady?()` to `DiscoveryRunnerWorker` interface
- Updated `ImproveSquash` worker type to include optional `waitUntilReady`
- Eliminates 5 `as unknown as { waitUntilReady }` casts

**Worker typing** (both `worker.ts` files):

- Replaced `{ onmessage: Function; postMessage: Function }` with typed
  `WorkerSelf` interfaces
- Removed all `ban-types` lint suppressions

**Legacy format handling** (`Creature.ts`, `Upgrade.ts`, `CRISPR.ts`):

- Used `Record<string, unknown>` for legacy property renaming (single documented
  cast)
- `CRISPR.ts` neuron type mutation simplified to direct assignment (the `type`
  property was already mutable)

**Unnecessary cast removed** (`DiscoveryReplayRunner.ts`):

- `discoveryReplayDiagnostics` already exists on `NeatConfig`; removed the
  pointless cast

## Evidence

This is a pure refactoring change with no visual output. All existing tests
pass:

- 2855 tests passed, 0 failed
- `deno check` passes with 0 type errors
- `deno lint` passes with 0 problems
- `deno fmt` passes

## Test Plan

- Added `test/methods/activations/TypeGuards.ts` — 7 tests for `hasUnSquash()`
  and `hasSimplifyBias()` type guards
- Added `test/propagate/sparse/SparseConfigLike.ts` — 2 tests for the
  `SparseConfigLike` interface (trace-all and selective)
- Added `test/config/GlobalDeclarations.ts` — 2 tests for typed global variable
  access
- Added `test/reconstruct/LegacyFormat.ts` — 3 tests for legacy JSON
  normalisation (`nodes→neurons`, `connections→synapses`)
- All 2855 existing + new tests pass

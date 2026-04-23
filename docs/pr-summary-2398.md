## Summary

Replaced the 32 scattered `// @ts-ignore - clearing to help GC` directives
with a centralised, typed helper `clearForGc()` (plus companion
`isReleased()`) exported from `src/utils/ReleasableRef.ts`. The helper
expresses the GC-hint intent at the call site, contains no `any` casts,
and a regression test ensures the unsafe pattern cannot reappear.
Closes #2398.

## Changes

- **New helper**: `src/utils/ReleasableRef.ts` exposes
  `clearForGc(host, key)` and `isReleased(host, key)`. The helpers use
  `Reflect.set`/`Reflect.get` to avoid `any` casts; the key type
  (`keyof T | (string & {})`) surfaces autocomplete for declared keys
  while still accepting any string so the helper works on `this` inside
  class methods (where polymorphic `keyof this` hides protected/private
  fields).

- **Directive replacements (32 sites, 7 files)**:
  - `src/multithreading/workers/MockWorker.ts` — 1
  - `src/multithreading/workers/WorkerHandler.ts` — 5
  - `src/multithreading/workers/WorkerProcessor.ts` — 12
  - `src/NEAT/ProcessCompletedResults.ts` — 9
  - `src/intelligentDesign/workers/MockWorker.ts` — 1
  - `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructureBase.ts` — 3
  - `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructureRecording.ts` — 1

- **Test site replacement**:
  `test/multithreading/WorkerDirectObjectPassing.ts` also used the
  pattern to simulate GC behaviour; updated to call `clearForGc`.

- **Regression guard**: `test/utils/ReleasableRef.ts` includes a test
  that scans `src/` and fails if any `// @ts-ignore - clearing` directive
  reappears.

## Evidence

Backend/library change — no UI to screenshot. Verified via:

- `deno check` passes (`./quality.sh --check-only`, exit 0).
- `deno fmt` + `deno lint --fix` clean (`./quality.sh --lint-only`).
- 7 new unit tests in `test/utils/ReleasableRef.ts` (all pass).
- Impacted test suites pass in full:
  - `test/multithreading/` + `test/utils/` + `test/intelligentDesign/`
    — 217 passed, 0 failed.
  - `test/NEAT/` + `test/architecture/ErrorGuidedStructuralEvolution/`
    — 649 passed, 0 failed.
- Regression test confirms zero `@ts-ignore - clearing` directives
  remain in `src/`.

## Test Plan

- `test/utils/ReleasableRef.ts` (new):
  - `clearForGc - clears a set reference to null`
  - `clearForGc - clears an already-null reference (no-op)`
  - `clearForGc - clears a required (non-nullable) field`
  - `clearForGc - leaves sibling fields untouched`
  - `clearForGc - happy-path round-trip (set, clear, set)`
  - `clearForGc - works on nested objects (clears one level)`
  - `no @ts-ignore GC-cleanup directives remain in src/` (regression
    guard)
- Existing `test/multithreading/WorkerDirectObjectPassing.ts` updated
  to use `clearForGc`; its "GC cleanup uses null instead of empty
  string" test still verifies the observable behaviour.

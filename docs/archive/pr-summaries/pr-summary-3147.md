# PR Summary — Issue #3147

## Summary

Removed the unused exported constant `DEFAULT_RUST_STREAM_RECORDS` (and its
JSDoc block) from
`src/architecture/ErrorGuidedStructuralEvolution/constants.ts`. A
whole-repository word-boundary search for the identifier returns exactly one hit
— the declaration itself — so it was an orphaned default that nothing consumed:
no module, test, bench, doc, barrel re-export, or `mod.ts` published surface
read it. Its siblings `DEFAULT_RUST_FLUSH_RECORDS` and
`DEFAULT_RUST_FLUSH_BYTES` are still referenced and remain untouched.

Closes #3147.

## Evidence

This is a backend dead-code removal with no web interface, so there is no
screenshot. Verification performed:

- Repo-wide search confirms zero readers before removal:

  ```
  $ grep -rn "DEFAULT_RUST_STREAM_RECORDS" --include="*.ts" --include="*.js" \
      --include="*.md" --include="*.json" .
  src/architecture/ErrorGuidedStructuralEvolution/constants.ts:13:export const DEFAULT_RUST_STREAM_RECORDS = 512;
  ```

  (single hit — the declaration itself, now deleted)

- `deno fmt`, `deno lint` (1740 files) and bash checks pass via
  `./quality.sh --lint-only`.
- `deno check src/architecture/ErrorGuidedStructuralEvolution/constants.ts mod.ts`
  passes (exit 0).
- Targeted module tests pass:
  `deno test test/ErrorGuidedStructuralEvolution/DiscoverStructureCleanUp.ts
  test/ErrorGuidedStructuralEvolution/DiscoveryRobustness.ts`
  → `7 passed | 0 failed`.

## Test Plan

No new test is added: the change deletes an unreferenced symbol with no
behaviour to assert. Correctness is established by (1) the repo-wide search
showing no consumer, and (2) the existing type-check (`deno check`) which would
fail on any dangling import, plus the existing `ErrorGuidedStructuralEvolution`
test suite continuing to pass. No existing tests were removed or modified.

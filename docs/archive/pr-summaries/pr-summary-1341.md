## Summary

Audit all tests to ensure they are meaningful "what" tests that verify
functionality, not "how" tests or benchmarks disguised as unit tests (Issue
#1341).

### Changes

**Deleted (benchmarks disguised as tests):**

- `test/mutate/AddNeuronFocusBenchmark.ts` — Pure timing benchmark using
  `performance.now()` to compare focus vs no-focus mutation speed. No
  correctness assertions.
- `test/score/NeuronComplexityPenaltyCacheBenchmark.ts` — Pure timing benchmark
  measuring cache speedup ratios. No correctness assertions.
- `test/FitnessDeduplicationBenchmark.ts` — Duplicate of
  `test/FitnessDeduplication.ts` that measured evaluation savings percentages
  instead of verifying deduplication correctness (which the existing
  `FitnessDeduplication.ts` already does well).

**Deleted ("how" test):**

- `test/DocumentationStructure.ts` — Grepped markdown files for specific
  headings, keywords, and content patterns. This tested documentation structure,
  not code functionality. Restructuring docs would break these tests even though
  no code behaviour changed.

**Cleaned up (removed benchmark code, kept functional tests):**

- `test/ShallowClone.ts` — Removed the "performance benchmark vs JSON clone"
  test that used `performance.mark()`/`performance.measure()` to compare timing.
  Kept all 12 functional tests verifying structure preservation, activation
  equivalence, mutable state copying, independence, and fittest creature
  protection.
- `test/mutate/ModWeightFocusBenchmark.ts` → renamed to
  `test/mutate/ModWeightFocus.ts` — Removed 2 benchmark tests that used
  `performance.now()` for timing comparisons and the `createLargeCreature`
  helper they depended on. Kept all 6 functional tests verifying focus list
  behaviour, edge cases, and connection correctness. Removed unused `AddNeuron`
  import.

**Updated documentation:**

- `AGENTS.md` — Expanded the Testing section with clear guidance on:
  - Unit tests vs benchmarks (where each belongs and why)
  - "What" tests (good) vs "how" tests (bad) with concrete examples
  - Naming conventions (avoid "Benchmark"/"Performance" in test file names)

## Evidence

Unable to generate screenshot: This is a library with no visual interface.

All 1991 tests pass after changes (`./quality.sh` clean).

## Test Plan

- No new tests added (this is a test audit/cleanup)
- Verified all 1991 remaining tests pass via `./quality.sh`
- Confirmed the 6 functional tests preserved in `ModWeightFocus.ts` still pass
- Confirmed the 12 functional tests preserved in `ShallowClone.ts` still pass
- Confirmed `test/FitnessDeduplication.ts` (the proper functional version)
  continues to pass, covering the same feature as the deleted benchmark

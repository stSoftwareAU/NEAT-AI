# PR Summary: Refactor: Split large discovery module source files (#1598)

Closes #1598

## Overview

Split six large source files in `src/discovery/` into focused,
single-responsibility modules. Pure refactor with no functional changes — all
4,372 tests pass.

## Files Split

| Original File                | Before | After | Extracted Modules                                                                                                                             |
| ---------------------------- | ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DiscoveryRunner.ts`         | 1,497  | 545   | `DiscoveryRunnerTypes.ts`, `DiscoveryRunnerEvaluation.ts`, `CandidateFiltering.ts`, `DiscoveryFormatting.ts`, `DiscoveryEvaluationSummary.ts` |
| `DiscoveryReplayRunner.ts`   | 1,133  | 541   | `DiscoveryReplayRunnerTypes.ts`, `ReplayEntryApplication.ts`, `ReplayHelpers.ts`                                                              |
| `FailureCache.ts`            | 1,088  | 358   | `FailureCacheTypes.ts`, `FailureCacheDiagnostics.ts`, `FailureCacheKey.ts`                                                                    |
| `CombinedCandidates.ts`      | 845    | 317   | `CombinedCandidateBuilders.ts`, `CombinedFromSuccessful.ts`                                                                                   |
| `CandidateApplication.ts`    | 615    | 246   | `CandidateApplicationOps.ts`                                                                                                                  |
| `BatchDiscoveryValidator.ts` | 615    | 443   | `BatchValidatorTypes.ts`                                                                                                                      |

## New Modules (15 files)

- **`DiscoveryRunnerTypes.ts`** (88 lines) — Worker interfaces and factory types
- **`DiscoveryRunnerEvaluation.ts`** (171 lines) — Task evaluation and result
  caching
- **`CandidateFiltering.ts`** (446 lines) — Candidate filtering and weighted
  sampling
- **`DiscoveryFormatting.ts`** (68 lines) — Percentage and error-delta
  formatting
- **`DiscoveryEvaluationSummary.ts`** (325 lines) — Evaluation summary recording
  and logging
- **`DiscoveryReplayRunnerTypes.ts`** (132 lines) — Replay runner interfaces and
  diagnostics types
- **`ReplayEntryApplication.ts`** (348 lines) — Replay entry application and
  duplication detection
- **`ReplayHelpers.ts`** (234 lines) — Worker pool setup, combo indices,
  concurrent mapping
- **`FailureCacheTypes.ts`** (108 lines) — Failure metadata and diagnostic
  interfaces
- **`FailureCacheDiagnostics.ts`** (264 lines) — Prediction tracing and creature
  change extraction
- **`FailureCacheKey.ts`** (267 lines) — Cache key building, hashing, and
  structural signatures
- **`CombinedCandidateBuilders.ts`** (228 lines) — Neuron, synapse, and squash
  candidate builders
- **`CombinedFromSuccessful.ts`** (341 lines) — Combination logic from
  successful candidates
- **`CandidateApplicationOps.ts`** (387 lines) — Low-level apply operations
  (add/remove/change)
- **`BatchValidatorTypes.ts`** (157 lines) — Validator interfaces, constants,
  and grouping logic

## Backward Compatibility

All original modules re-export their extracted symbols, so no consumer import
paths need to change.

## Quality

- `deno fmt` — clean
- `deno lint` — clean
- `deno check` — clean
- All 4,372 tests pass

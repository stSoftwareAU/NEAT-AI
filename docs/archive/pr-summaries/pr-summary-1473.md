# PR Summary: Refactor: Extract DiscoveryCandidates.ts into focused modules (#1473)

Closes #1473

## Summary

Decomposes `DiscoveryCandidates.ts` (2,227 lines) into 5 focused,
single-responsibility modules following the extraction pattern established by
the DiscoverStructure.ts refactoring (Issue #1472). The original file is reduced
to a 387-line coordinator that delegates to extracted functions.

## Extracted Modules

| Module                     | Lines | Responsibility                                                                |
| -------------------------- | ----- | ----------------------------------------------------------------------------- |
| `CombinedCandidates.ts`    | 845   | Multi-step combination strategies, phase-2 scoring, candidate pruning         |
| `CandidateApplication.ts`  | 615   | Validation, applying candidate changes to creatures, forward-only enforcement |
| `CandidateCreation.ts`     | 483   | Single-step candidate builders (neurons, synapses, squash, removal)           |
| `CandidateDescriptions.ts` | 155   | Emoji selection and human-readable description generation                     |
| `CandidateScoring.ts`      | 77    | Weighted-average expected improvement calculations                            |

## Design Decisions

- **Standalone exported functions with explicit parameters** rather than shared
  context objects, matching the extraction patterns from #1472
- **Re-exports** from `DiscoveryCandidates.ts` (`shortID`,
  `buildCombinedFromSuccessful`, `pruneSuccessfulCandidatesForCombos`) maintain
  backward compatibility for all external consumers
- **Type definitions remain in coordinator** — the public API types
  (`DiscoveryCandidate`, `ScoredDiscoveryCandidate`, etc.) stay in
  `DiscoveryCandidates.ts` since they define the module's interface contract
- **Replaced `any` with `CreatureExport`** in `CandidateApplication.ts` for
  improved type safety (bonus improvement during extraction)
- **No functional changes** — purely structural refactoring

## Evidence

- `DiscoveryCandidates.ts`: 2,227 → 387 lines (83% reduction, well under 600
  target)
- All 3,823 tests pass (0 failures)
- `quality.sh` passes cleanly (fmt, lint, type-check, all tests)
- No external import paths changed (re-exports preserve backward compatibility)

## Test Plan

- [x] `quality.sh` passes (fmt + lint + type-check + all 3,823 tests)
- [x] No changes to test files required
- [x] All re-exports from `DiscoveryCandidates.ts` preserved for backward
      compatibility
- [x] No functional behaviour changes

# PR Summary — Update COMPARISON.md (Issue #2563)

## Summary

Refresh `COMPARISON.md` to reflect features added since the last update on
2026-04-12 (PR #2236). Closes #2563.

The previous revision predates 115 commits of substantive changes. The
following new capabilities are now documented:

- **Muon-style orthogonalised gradient updates** (PRs #2529, #2544) — added as
  a unique-approach section and to the training-methods feature list.
- **DNA-sharing primitives** (PRs #2491–#2496, #2499, #2503, #2504) —
  `PruningTemplateStrategy` (recommended), `KnowledgeDistillation`,
  `CompactModuleGraft`, `KnobTuningStrategy`. Added under transfer learning
  and unique features. Removed "knowledge distillation" from the
  "What's Still Missing" list.
- **Fitness sharing with per-species breeding quotas** (PR #2476).
- **Stagnant species detection and retirement** (PR #2477).
- **Soft compatibility-gated cross-species breeding** (PR #2478).
- **Diversity-aware MCMC temperature curriculum** (PR #2475) — extended the
  existing MCMC unique-approach section.
- **Fitness-driven squash mutation via per-role tracker** (PR #2473).
- **Optional Rust CLI scorer with WASM fallback** (PR #2389).
- **NEAT-AI-core pinning and parity gate** (PRs #2342, #2345, #2415, #2442) —
  documents the WASM-only contract for topology helpers, topological
  backprop, and elastic distribution.

The conclusion paragraph and the consolidated pros list were extended to
reference these additions.

## Evidence

This is a documentation-only change with no UI or measurable performance
characteristic. Verification:

- `npx markdownlint-cli2 COMPARISON.md` → 0 errors.
- Each new bullet was cross-checked against the source code by reading the
  configuration files (`src/config/FitnessSharingConfig.ts`,
  `src/config/SpeciesStagnationConfig.ts`,
  `src/config/CompatibilityGatingConfig.ts`,
  `src/config/SquashEffectivenessConfig.ts`,
  `src/config/MCMCConfig.ts`,
  `src/config/RustScorerConfig.ts`,
  `src/propagate/MuonOrthogonalisation.ts`,
  `src/transfer/`) to confirm class names, defaults, and opt-in vs default
  status.

```mermaid
flowchart LR
    A[Issue 2563] --> B[Survey 115 commits]
    B --> C[Verify features in src/]
    C --> D[Update COMPARISON.md]
    D --> E[markdownlint clean]
```

## Test Plan

- [x] `npx markdownlint-cli2 COMPARISON.md` passes with zero errors.
- [x] All feature additions are backed by concrete source-code references
  (config classes, files, default values).
- [x] No code logic changed; only `COMPARISON.md` and this summary.

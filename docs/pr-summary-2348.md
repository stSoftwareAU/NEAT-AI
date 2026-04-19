## Summary

Document the scorer alignment policy ensuring NEAT-AI-scorer (and equivalent
downstream consumers) pin the same `neat-core` rev as NEAT-AI, preventing
version skew. Closes #2348.

### Changes

- **`docs/CORE_DEPENDENCY_POLICY.md`** — added "Downstream Consumer Alignment
  (Scorer)" section with NEAT-AI-scorer requirements, verification checklist,
  and bench script guidance.
- **`docs/EXTERNAL_NEAT_AI_CORE.md`** — added "NEAT-AI-scorer Alignment" section
  with concrete verification commands; updated architecture diagram to reference
  NEAT-AI-scorer by name.
- **`AGENTS.md`** — added rule 7 (scorer alignment) to the NEAT-AI-core
  dependency policy section.

### Confirmed

- No `BENCH_RUST_SCORER` scripts exist yet — the policy now documents the
  expectation that bench scripts referencing crate layout are updated when the
  scorer crate is added or restructured.
- The NEAT-AI-scorer repository does not yet exist publicly; the policy is
  forward-looking and ready to enforce alignment once it does.

## Evidence

This is a documentation and policy change with no runtime code. Verified via:

- All 5990 tests pass (0 failed) including new policy tests
- Quality gate (`./quality.sh --skip-discovery --skip-wasm`) passes cleanly

## Test Plan

- Added `test/scripts/ScorerAlignmentPolicy.ts` (4 tests):
  - `core dependency policy documents scorer alignment requirement`
  - `external core doc covers scorer workspace alignment`
  - `policy documents the same-rev requirement for scorer`
  - `external core doc explains how to verify scorer alignment`
- All 8 existing `test/scripts/CoreDependencyPolicy.ts` tests continue to pass

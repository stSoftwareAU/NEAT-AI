## Summary

Add contributor documentation for working with the external NEAT-AI-core
dependency: how to bump the pinned `neat-core` revision, how to use local path
overrides for development, the parity gate workflow, and cross-repository links.
Also adds core dependency documentation references to README.md. Closes #2341.

This addresses the documentation success criterion of the epic ("Documentation
and contributor workflow explain how to bump the core dependency and run local
overrides when needed") and the child issue #2347.

### Epic #2341 status

| Child issue | Title | Status |
|-------------|-------|--------|
| #2342 | Release & pinning model | Closed |
| #2343 | Cargo workspace / dependency wiring | Closed |
| #2344 | CI & caches for external core | Closed |
| #2345 | Parity gate before deletion | Closed |
| #2346 | Remove in-tree native Rust | No duplicate exists — [commented](https://github.com/stSoftwareAU/NEAT-AI/issues/2346#issuecomment-4274852968) |
| #2347 | Contributor docs for bumps & overrides | Addressed in this PR |
| #2348 | Align NEAT-AI-scorer | PR #2356 in progress |

## Evidence

This is a documentation-only change with no UI or performance impact.

- All 5992 tests pass (0 failed, 3 ignored).
- Quality gate (`./quality.sh --skip-wasm --skip-discovery`) passes cleanly.
- New tests in `test/scripts/ContributorCoreDocs.ts` verify the documentation
  covers all required topics.

## Test Plan

- Added `test/scripts/ContributorCoreDocs.ts` with 6 tests verifying:
  - CONTRIBUTING.md covers NEAT-AI-core version bumping (`cargo update`)
  - CONTRIBUTING.md covers local development overrides (`.cargo/config.toml`)
  - CONTRIBUTING.md cross-links `CORE_DEPENDENCY_POLICY.md`
  - CONTRIBUTING.md cross-links the NEAT-AI-core repository
  - README.md references core dependency documentation
  - CONTRIBUTING.md mentions the parity gate

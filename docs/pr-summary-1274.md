## Summary

Documentation cleanup following DRY principle (#1274). Created `AGENTS.md` as
the single source of truth for coding conventions, project terminology,
directory structure, and development workflows. Refactored `README.md` to be a
concise, human-readable project overview that delegates coding guidelines to
`AGENTS.md`. Removed duplicated content:

- **Terminology** was defined identically in both `README.md` and
  `COMPARISON.md` - now defined once in `AGENTS.md` and referenced elsewhere
- **Discovery details** (failure cache, success cache, replay, category limits,
  focus overrides, cost-of-growth gate) were duplicated between `README.md` and
  `docs/DISCOVERY_GUIDE.md` - removed from `README.md`, kept in dedicated docs
- **Deployment Checklist** and **Rust Discovery Module setup** moved from
  `README.md` to `AGENTS.md` where they belong as developer reference
- **Feed-forward vs recurrent** topology explanation consolidated into
  `AGENTS.md`

The `README.md` was reduced from ~587 lines to ~142 lines while retaining all
essential information for users (features, quick start, documentation links).

## Evidence

Unable to generate screenshot: This is a CLI library with no visual interface.
The changes are documentation-only (markdown files).

## Test Plan

- Added `test/DocumentationStructure.ts` with 10 tests verifying:
  - `AGENTS.md` exists and contains required sections (terminology, coding
    conventions, architecture info, deployment checklist, file structure)
  - `README.md` references `AGENTS.md` and does not duplicate terminology or
    detailed discovery documentation
  - `COMPARISON.md` references `AGENTS.md` for terminology instead of
    duplicating it
  - `README.md` retains essential human-readable sections (Feature Highlights,
    Usage, License, Documentation)
- All 1747 tests pass (including 10 new documentation structure tests)
- `quality.sh` passes cleanly

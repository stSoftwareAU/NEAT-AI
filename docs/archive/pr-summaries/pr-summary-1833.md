## Summary

Archive 282 PR summary files from `docs/` to `docs/archive/pr-summaries/` to
declutter the documentation directory. No content was modified — files were
relocated only. Updated AGENTS.md documentation layout to reference the new
archive location. Closes #1833.

## Changes

- Created `docs/archive/pr-summaries/` directory
- Moved all 282 `pr-summary-*.md` files from `docs/` into the archive
- Updated AGENTS.md Documentation Layout section to list the archive directory
- Verified no `.gitignore` or build scripts reference the old paths
- Verified no external documentation links to individual PR summary files

## Evidence

- No broken links: all cross-references between PR summary files are internal
  (within other PR summary files that were also moved)
- No shell scripts or configuration files reference `docs/pr-summary-*.md`
- Quality checks pass cleanly

## Test Plan

- This is a documentation-only change (file relocation); no code logic was
  modified
- Verified `docs/` no longer contains any `pr-summary-*.md` files
- Verified all 282 files exist in `docs/archive/pr-summaries/`
- Ran `./quality.sh --skip-tests --skip-discovery --skip-wasm` — all checks pass

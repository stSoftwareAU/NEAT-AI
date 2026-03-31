## Summary

Merge milestone 'Creature-FIX' branch to Develop. Closes #2109.

All issues in the Creature-FIX milestone are complete and have been merged into
the milestone branch. This PR brings those changes into Develop.

### Closed issues in this milestone

- #2106: GRQ batch: fix() failed on 9 model(s)
- #2105: GRQ v1: fix() failed on 3 model(s)
- #2103: GRQ v1: fix() failed on 1 *.unfixable model(s)

### Changes included

- Merge conflict cleaner utility (`src/utils/MergeConflictCleaner.ts`) for
  handling JSON files with git merge conflict markers
- Integration of merge conflict cleaning into `Creature.fromJSON`
- Test coverage for merge conflict JSON handling
  (`test/fix/MergeConflictJSON.ts`)
- Updated WASM activation module

## Evidence

- All 5176 tests pass (`quality.sh` clean run)
- Fast-forward merge with no conflicts

## Test Plan

- Existing test suite validates all milestone changes
- `test/fix/MergeConflictJSON.ts` covers the new merge conflict cleaning
  functionality
- Full quality gate passed (lint, format, type-check, tests)

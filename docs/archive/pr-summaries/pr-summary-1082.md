## Summary

Fixed the "Unknown approach 'discovered'" error that occurred during the
fine-tuning phase after a discovery process completed.

The root cause was a mismatch between:

- `Neat.ts:392` which tags improved creatures with `approach='discovered'` (past
  tense)
- `LogApproach.ts` which only recognised `'discovery'` (noun form) in its
  `Approach` type union

The fix adds `'discovered'` to the `Approach` type and handles it in the switch
statement alongside `'discovery'`, since both values indicate the creature came
from the discovery process.

## Evidence

Unable to generate screenshot: This is a CLI-only library with no visual
interface.

The bug is reproduced and verified fixed by the test case:

- `test/NEAT/LogApproach.ts` - "logApproach: should handle 'discovered' approach
  without throwing error (issue #1082)"

## Test Plan

Added `test/NEAT/LogApproach.ts` with the following test cases:

- `logApproach: should handle 'discovered' approach without throwing error (issue #1082)` -
  Directly tests the reported bug
- `logApproach: should handle 'discovery' approach without throwing error` -
  Ensures existing behaviour is preserved
- `logApproach: should handle all valid approach types` - Comprehensive test for
  all 8 approach values
- `logApproach: should throw error for truly unknown approaches` - Ensures
  invalid approaches still throw errors

All 1319 tests pass including the new tests.

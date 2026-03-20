## Summary

Add trace tags to indicate Predictive Coding was used during training. When a
creature is trained via the PC path (`trainDirPredictiveCoding()`), the exported
trace and compact JSON now include `approach: "predictive-coding"` plus metrics
tags (`pc-energy`, `pc-inference-steps`, `pc-changed`). These tags propagate
through the scheduling pipeline in `NeatEvolution.ts` so they survive into the
final population. Standard backprop training is unaffected and does not add
PC-specific tags. Closes #1913.

## Evidence

- 7 new tests in `test/predictiveCoding/PredictiveCodingTags.ts` verify:
  - Tags are present after PC training (approach, energy, inference steps, changed)
  - Tags survive JSON export/import round-trip
  - Tags are added to compact output
  - Standard backprop does NOT add PC-specific tags
- All 4763 existing tests continue to pass

## Test Plan

- Added `test/predictiveCoding/PredictiveCodingTags.ts` with 7 tests:
  - `PC training adds approach tag to trace`
  - `PC training adds energy tag to trace`
  - `PC training adds inference steps tag to trace`
  - `PC training adds changed tag to trace`
  - `PC tags survive JSON export/import round-trip`
  - `PC tags are added to compact output when available`
  - `Standard backprop does NOT add PC-specific tags`

## Summary

Second pass audit of all 83 remaining test files in `test/propagate/` to ensure
they meet quality standards. Addresses #1766.

### Changes

1. **SynapseState.ts**: Removed 2 trivial tests that only verified JavaScript
   object mutability and instance independence (language features, not real
   behaviour). Kept and improved the name of the constructor defaults test.

2. **Trace.ts**: Renamed 4 vague hyphenated test names to descriptive
   behavioural names (e.g. "Trace-load-memetic" → "Trace - loads creature with
   memetic data from JSON").

3. **simple/Simple.ts**: Renamed "Simple" to "simple backpropagation converges
   after bias and weight perturbation".

4. **biasIdentity/Simple.ts**: Renamed "Simple" to "bias-only backpropagation
   converges with all-IDENTITY squash functions".

5. **PI.ts**: Renamed "PI Multiple" to "PI - converges toward PI*input after
   1000 random training samples".

6. **Recorder/TestRecord.ts**: Renamed "record" to "record - playback error
   remains consistent after recording and replay". Replaced commented-out
   assertion with real assertions verifying playback error is finite and
   consistent with recording error.

### Audit Summary

All 83 test files in `test/propagate/` (including subdirectories `record/`,
`sparse/`, `bias/`, `biasIdentity/`, `calculateError/`, `large/`, `minimum/`,
`simple/`, `Recorder/`) were reviewed against the audit criteria:

- **No duplicates remain**: `biasIdentity/Simple.ts` and `bias/Simple.ts` are
  distinct tests (all-IDENTITY vs mixed squash functions with different topology
  configurations).
- **All tests verify behaviour**: No source-grepping or implementation-detail
  tests found.
- **All tests have real assertions**: Fixed the one test (TestRecord.ts) that
  had commented-out assertions.
- **Test names clearly describe behaviour**: Fixed 7 vague test names across 6
  files.

## Test Plan

- All 4824 tests pass
- `./quality.sh` passes cleanly
- No production code changes — test-only audit

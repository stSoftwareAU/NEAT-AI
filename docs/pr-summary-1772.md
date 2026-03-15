## Summary

Final audit pass: strengthen weak assertions and improve test names in
compact/optimisation tests. Closes #1772.

All test files in `test/Compact/`, `test/optimize/`, `test/optimization/`,
`test/FeedForward/`, and `test/reconstruct/` have been reviewed against the
audit criteria. Previous PRs addressed duplicates, trivial tests, and
cross-area overlaps. This final pass strengthens the remaining weak assertions
and improves test names.

### Changes

**CompactCreatureCloneOptimisation.ts** — strengthened two weak assertions and
improved all 13 test names:

- **Neuron tags test**: Previously only asserted the output neuron exists — it
  never checked that the tagged neuron's tags survived compaction. Redesigned to
  use a backward-synapse compaction scenario where the tagged LOGISTIC neuron
  survives, then verifies the specific tag name and value.

- **Creature-level tags test**: Previously only asserted `exported.tags` is
  truthy. Now verifies the specific tag values ("model-version"/"1.0.0" and
  "training-run"/"experiment-42") are present after compaction.

- **Test names**: All 13 test names updated from implementation-focused names
  (e.g. "optimised clone produces independent neuron arrays") to
  behaviour-focused names (e.g. "compaction does not modify original creature
  neurons").

## Evidence

- All 4509 tests pass
- `./quality.sh` passes cleanly

## Test Plan

- Modified: `test/Compact/CompactCreatureCloneOptimisation.ts` (13 tests)
  - Strengthened assertion: neuron tags verified by name/value after compaction
  - Strengthened assertion: creature-level tags verified by name/value
  - All test names improved to describe behaviour being verified
- Full test suite passes (4509 tests, 0 failures)

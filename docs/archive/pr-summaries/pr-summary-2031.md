## Summary

Enable the previously ignored discovery scenario test for fan-in synapse
patterns. The test was disabled pending resolution of upstream issue
stSoftwareAU/NEAT-AI-Discovery#928, which has now been closed.

The mock discovery result used incorrect index-based neuron IDs (2, 3) instead
of the deterministic IDs computed from UUIDs via `deterministicIdFromUuid`.
Fixed to use the correct IDs (hidden-B: 1775329633, hidden-A: 1775329634) so the
synapse lookup succeeds. Closes #2031.

## Changes

- Removed `ignore: true` from the `Deno.test()` options in
  `test/discovery/DiscoveryScenarioFanInSynapsePatterns.ts`
- Fixed `hiddenBId` and `hiddenAId` to use deterministic UUID-based IDs instead
  of array indices
- Removed unused `_skipReason` variable and `discoverySkipReason` import

## Test Plan

- All 7 tests in `test/discovery/DiscoveryScenarioFanInSynapsePatterns.ts` pass
  (including the previously ignored one)
- Full test suite passes: 5021 passed, 0 failed via `./quality.sh`

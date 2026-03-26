## Summary

Enable the previously ignored discovery scenario test for adding synapses
between hidden neurons. The upstream NEAT-AI-Discovery issue
(stSoftwareAU/NEAT-AI-Discovery#925) has been resolved. Closes #2028.

Changes:

- Removed `ignore: true` from the discovery test so it now runs
- Removed unused `_skipReason` variable and its `discoverySkipReason` import
- Fixed neuron IDs in the mock discovery result to use correct
  `deterministicIdFromUuid` values (1775329634 for hidden-A, 1775329633 for
  hidden-B) instead of incorrect sequential indices (2, 3)

## Evidence

All 5 tests in `DiscoveryScenarioAddSynapseBetweenHidden.ts` pass:

```
ok | 5 passed | 0 failed (23ms)
```

## Test Plan

- Verified `test/discovery/DiscoveryScenarioAddSynapseBetweenHidden.ts` runs and
  all 5 tests pass (including the newly enabled discovery candidate test)
- Ran `./quality.sh` to confirm no regressions

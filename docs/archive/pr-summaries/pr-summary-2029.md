## Summary

Enable the previously ignored discovery scenario test for adding a neuron
between hidden neurons. The upstream NEAT-AI-Discovery issue
stSoftwareAU/NEAT-AI-Discovery#926 has been resolved, so the test can now run.
Closes #2029.

The test's mock discovery result used hardcoded sequential neuron IDs (2, 3)
which did not match the actual hash-based neuron IDs assigned by
`Creature.fromJSON()`. Fixed by dynamically resolving neuron IDs from the
constructed crippled creature at runtime, which is consistent with how the
discovery system works in production.

Changes in `test/discovery/DiscoveryScenarioAddNeuronBetweenHidden.ts`:

- Removed `ignore: true` from the discovery candidate test
- Removed the unused `_skipReason` variable and `discoverySkipReason` import
- Fixed mock discovery result to use actual hash-based neuron IDs instead of
  hardcoded sequential indices

## Evidence

All 6 tests in the file pass, including the previously ignored test:

```
ok | 6 passed | 0 failed (10ms)
```

Full quality suite: 5012 passed, 5 ignored (other tests), 1 unrelated flaky
failure (`TrainingEvent - plateau_detected`) which passes when run individually.

## Test Plan

- Verified all 6 tests in
  `test/discovery/DiscoveryScenarioAddNeuronBetweenHidden.ts` pass
- Ran `./quality.sh` to confirm no regressions from the change
- The previously ignored test now runs and validates that the discovery process
  correctly identifies add-neurons candidates between hidden neurons

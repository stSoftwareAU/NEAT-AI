## Summary

Enable the previously ignored discovery scenario test for removing harmful synapses. The upstream NEAT-AI-Discovery issue stSoftwareAU/NEAT-AI-Discovery#927 has been resolved. Closes #2030.

### Changes

- Removed `ignore: true` from the `Deno.test()` options in `test/discovery/DiscoveryScenarioRemoveHarmfulSynapse.ts`
- Fixed neuron IDs in the mock discovery result to use correct UUID-derived integer IDs (`1775329634` for hidden-A, `1775329633` for hidden-B) instead of incorrect index values (`2`, `3`)
- Removed unused `_skipReason` variable and `discoverySkipReason` import

## Evidence

All 5019 tests pass, 0 failures. The previously ignored test now runs and passes:
- `DiscoveryScenario: remove harmful synapse - discovery finds remove-synapse candidate`

## Test Plan

- Verified `deno test -A test/discovery/DiscoveryScenarioRemoveHarmfulSynapse.ts` passes all 5 tests (including the newly enabled one)
- Verified `./quality.sh` passes cleanly (5019 passed, 0 failed)

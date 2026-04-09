## Summary

Enable the previously ignored discovery scenario test for change-squash (TANH to
IDENTITY). The test was disabled pending upstream resolution of
stSoftwareAU/NEAT-AI-Discovery#930, which is now closed.

Fixed the root cause of the test failure: the mock discovery result used
`neuronId: 2` (a sequential index), but the integer ID system uses deterministic
hashes from UUIDs. The hidden neuron "hidden-A" has ID `1775329634`, not `2`.
Updated the test to dynamically resolve the correct neuron ID from the exported
creature, matching the robust pattern used by other discovery scenario tests.

Closes #2033.

## Changes

- Removed `ignore: true` from the change-squash discovery test
- Removed unused `_skipReason` variable and `discoverySkipReason` import
- Fixed `hiddenAId` to dynamically resolve the correct deterministic integer ID
  instead of using incorrect hardcoded value `2`
- Added `Creature` import needed for dynamic ID resolution

## Evidence

All 5023 tests pass (previously 5022 passed + 1 ignored):

```
ok | 5023 passed (2 steps) | 0 failed | 1 ignored (54s)
```

## Test Plan

- The test
  `"DiscoveryScenario: change squash TANH→IDENTITY - discovery finds change-squash candidate"`
  now runs and passes
- All existing tests continue to pass
- `./quality.sh` passes cleanly

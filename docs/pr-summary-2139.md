## Summary

Fixed creature corruption crash caused by self-connection synapses in forward-only creatures. Closes #2139.

Old v1.x/v2.x creatures loaded from disk can contain self-connection synapses (a neuron connecting to itself), which are illegal in forward-only mode. When these creatures were prepared for breeding via `prepareCreatureForBreeding()` → `validateFourX()`, the `SELF_CONNECTION` validation error was not in the repairable error list, causing an uncaught exception that crashed the entire evolution process (as seen in GRQ-18 logs).

The fix adds `SELF_CONNECTION` to the repairable error reasons in `validateFourX()`. The existing `creature.fix({ forwardOnly: true })` already handles self-connection removal (line 160 of `CreatureMutation.ts`), so the repair path simply needed to be enabled for this error type.

## Evidence

- GRQ-18 log shows three crash events from self-connections in v1.0.0 and v2.0.0 creatures
- The third crash was uncaught and killed the worker process
- After the fix, self-connections are silently removed during the repair pass

## Test Plan

- Added `test/upgrade/UpgradeRepairsSelfConnectionForwardOnly.ts` with 3 tests:
  - `validateFourX repairs self-connection synapses in forward-only creatures`
  - `upgrade() repairs self-connection in pre-4.x creature loaded as forward-only`
  - `prepareCreatureForBreeding repairs multiple self-connections`
- Updated `test/upgrade/UpgradeFourXRepair.ts`: changed self-connection test from expecting throw to expecting repair
- Updated `test/upgrade/VersionThree.ts`: changed self-connection test from expecting throw to expecting repair
- Updated `test/feedForward/ForwardOnlyFlag.ts`: changed breeding test from expecting throw to expecting successful breeding after self-connection repair
- All 5211 tests pass (0 failures)

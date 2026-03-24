## Summary

Create a shared test helper utility for the "cripple and discover" testing pattern.
This adds `test/discovery/DiscoveryScenarioHelper.ts` which implements a reusable
workflow for discovery scenario tests: accept a whole creature, record baseline
outputs, accept a crippled creature, trace and record errors, and optionally build
discovery candidates. Closes #1990.

## Evidence

- All 4932 tests pass via `./quality.sh` (0 failures)
- Lint, format, and type-check all pass cleanly
- Smoke tests verify the helper orchestrates the full workflow correctly

## Test Plan

- Added `test/discovery/DiscoveryScenarioHelperSmokeTest.ts` with 7 tests:
  - `runDiscoveryScenario returns valid results` — verifies creature creation, output counts, and empty candidates when no discovery result is provided
  - `whole and crippled creatures produce different outputs` — confirms the cripple degrades performance
  - `assertCrippleDegraded succeeds for degraded creature` — tests the degradation assertion helper
  - `tracing captures error records` — verifies the recording pipeline captures errors
  - `traceAllConfig creates valid sparse config` — tests the sparse config factory
  - `discoverySkipReason formats correctly` — tests the skip reason formatter
  - `creatures are validated and have UUIDs` — confirms validation and UUID assignment

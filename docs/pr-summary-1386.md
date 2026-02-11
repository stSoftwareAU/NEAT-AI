## Summary

Increased the default discovery sample size to give the Rust discovery engine significantly more data for structural decisions. Closes #1386.

### Changes

1. **`discoverySampleRate` default: 0.05 (5%) -> 0.2 (20%)**
   - 4x more training records are now sampled during the discovery recording phase
   - Larger samples improve the statistical significance of candidate rankings and reduce the chance of missing edge cases

2. **`discoveryRecordTimeOutMinutes` default: 1 -> 5**
   - Increased to accommodate the higher sample rate
   - At ~700 records/sec, 5 minutes allows recording ~210k samples (sufficient for 20% of a 1M-record dataset)

3. **Exported named constants** (`DEFAULT_DISCOVERY_SAMPLE_RATE`, `DEFAULT_DISCOVERY_RECORD_TIMEOUT_MINUTES`)
   - Single source of truth for defaults, referenced by both production code and tests

Both values remain fully configurable via `NeatOptions` — existing users who explicitly set these values are unaffected.

### WASM/Rust suggestions

The issue asked whether migrating logic to Rust/WASM would help. The recording phase is already I/O-bound (reading binary files and streaming to Rust via FFI), so the bottleneck is not TypeScript computation — it is the volume of data fed to the Rust analyser. Increasing the sample rate directly addresses this by giving Rust more data to work with, which is the simplest and most impactful improvement.

## Evidence

This is a configuration-only change with no UI components. Evidence is provided by the test suite:
- All 2,255 tests pass (including 6 new tests)
- `./quality.sh` completes cleanly

## Test Plan

- Added `NeatConfigParseOptions - discoverySampleRate default is 0.2 (#1386)` — verifies the new default constant value and that `createNeatConfig({})` uses it
- Added `NeatConfigParseOptions - discoveryRecordTimeOutMinutes missing uses default` — verifies the new timeout default
- Added `NeatConfigParseOptions - discoveryRecordTimeOutMinutes default is 5 (#1386)` — verifies the constant value
- Added `NeatConfigParseOptions - discoverySampleRate explicit override still works` — verifies users can still set custom values
- Added `NeatConfigParseOptions - discoveryRecordTimeOutMinutes explicit override still works` — verifies custom timeout values
- Updated existing `discoverySampleRate missing uses default` test to reference the named constant

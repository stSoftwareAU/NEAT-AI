## Summary

This PR implements Issue #997: NEAT Options to accept a discovery cache
directory.

### Changes Made

1. **New `discoveryCacheDir` option in NeatOptions**
   - Added a new configuration option `discoveryCacheDir` to `NeatArguments.ts`
   - When provided, this base directory is used to derive the
     `discoverySuccessCacheDir` (`{base}/success`) and
     `discoveryFailureCacheDir` (`{base}/failure`) unless explicitly overridden
   - Empty strings are treated as undefined

2. **Non-blocking background replay of cached discoveries**
   - Created new `DiscoveryReplayQueue` class
     (`src/NEAT/DiscoveryReplayQueue.ts`) that handles background replay of
     cached discoveries against new fittest creatures
   - Key features:
     - Only one replay process runs at a time (as per issue requirements)
     - When a new fittest is found during replay, it's queued for processing
       next
     - Only the most recent queued creature is kept (older ones are discarded)
     - Completed results are collected and integrated into the population

3. **Integration with Neat class evolution loop**
   - When a new "fittest" creature is found during evolution and
     `discoveryCacheDir` is configured, the discovery replay is automatically
     scheduled in the background
   - Completed replay results are processed and improved creatures are added to
     the population with the `discovery-replay` approach tag
   - The data directory is passed to the Neat instance via `setDataDir()` to
     enable replay functionality

### Benefits

- **Persistence of learnings**: Discoveries from previous evolution runs can be
  re-applied when evolution restarts
- **Non-blocking**: The replay process runs in the background and doesn't block
  the main evolution loop
- **Automatic configuration**: Setting `discoveryCacheDir` automatically
  configures the success and failure cache directories

## Evidence

Unable to generate screenshot: This is a CLI-only tool/library with no visual
interface. The feature adds configuration options and background processing that
don't produce visual output.

## Test Plan

- Added `test/NEAT/DiscoveryCacheDir.ts` with 6 tests covering:
  - Default value is undefined
  - Accepts valid directory paths
  - Accepts relative paths
  - Derives success/failure cache subdirectories automatically
  - Explicit success/failure dirs override derived ones
  - Empty strings treated as undefined

- Added `test/NEAT/DiscoveryReplayQueue.ts` with 7 tests covering:
  - Schedules replay when new fittest is detected
  - Only one replay runs at a time
  - Returns improved creature in results
  - Skips replay if no cache directory configured
  - Queues newest fittest when replay in progress
  - `isReplayInProgress()` returns correct state
  - `clearCompletedResults()` removes results

All 1383 existing tests continue to pass.

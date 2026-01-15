# Performance: Batch discovery candidate processing (#1020)

## Summary

This PR implements non-blocking discovery processing for the NEAT-AI evolution
loop. Previously, when discovery completed, the results were applied to the
**current fittest** creature, which may have evolved significantly during the
long-running discovery process. This could lead to incompatible changes being
applied.

### Key Changes

1. **Build improved creature immediately**: When discovery completes in
   `scheduleDiscovery()`, the improved creature is now built from the **original
   creature** (the one that was analysed) rather than waiting to apply changes
   to the current fittest.

2. **Direct population addition**: In `evolve()`, discovered creatures are now
   added directly to the population without applying transformations to the
   current fittest. This simplifies the code and ensures discovery results are
   based on the creature that was actually analysed.

3. **ResponseData interface update**: Added `improvedCreature` field to the
   discovery response, allowing the pre-built creature to be stored and
   retrieved during evolution.

### Why This Approach?

The issue notes:

- "I don't want the evolution process to block while the discovery process runs"
- "When the discovery process completes just add the 'discovered' creature to
  the population for normal evolution"
- "We will add later #997 the ability to replay the discoveries on the current
  fittest"

This implementation:

- ✅ Keeps discovery non-blocking (evolution continues during discovery)
- ✅ Adds discovered creature directly to population
- ✅ Preserves the original creature context (discovery runs on creature X,
  results apply to creature X)
- ✅ Simplifies the code by removing complex combination logic (synapse add +
  remove + squash combinations)

## Evidence

This is a performance/architectural change. Unable to provide benchmark results
as discovery requires a GPU and Rust library for the full workflow. The change
simplifies the code path by:

1. Removing ~80 lines of complex combination logic in `evolve()`
2. Building the improved creature once (in `scheduleDiscovery`) instead of
   multiple variants
3. Reducing the number of creatures added per discovery from potentially 5+
   (various combinations) to 1

## Test Plan

- Added tests in `test/NEAT/BatchDiscoveryProcessing.ts`:
  - `DiscoverStructure.addHelpfulSynapses creates modified creature correctly` -
    Verifies synapse addition works
  - `DiscoverStructure.removeSynapse creates modified creature correctly` -
    Verifies synapse removal works
  - `Discovery response can include improved creature JSON for direct addition to population` -
    Tests the new `improvedCreature` field
  - `Discovered creature should preserve discovery tags when added to population` -
    Verifies metadata preservation
  - `Population can include discovered creatures alongside normal evolution` -
    Tests population management

All existing tests continue to pass (1310 tests).

## Files Changed

- `src/NEAT/Neat.ts` - Modified `scheduleDiscovery()` to build improved
  creature, simplified `evolve()` discovery processing
- `src/multithreading/workers/WorkerHandler.ts` - Added `improvedCreature` field
  to `ResponseData.discover`
- `test/NEAT/BatchDiscoveryProcessing.ts` - New test file for batch discovery
  processing

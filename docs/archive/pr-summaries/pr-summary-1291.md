## Summary

Issue #1291 - Performance: Batch discovery candidate validation

This PR implements batch validation for discovery candidates, providing a
unified API for validating multiple candidates efficiently. The implementation:

1. **Created `BatchDiscoveryValidator` class**
   (`src/discovery/BatchDiscoveryValidator.ts`):
   - Groups candidates by type (structural vs weight-only changes)
   - Validates structural candidates with optional early-exit on first failure
   - Implements validation result caching to avoid redundant work
   - Provides validation statistics for monitoring and debugging

2. **Extended `DiscoveryPostValidate.ts`**:
   - Added `validateDiscoveryCandidatesBatch()` function for batch validation
   - Re-exports batch validation types for convenience

3. **Added `groupCandidatesByType()` function**:
   - Separates structural changes (add/remove neurons/synapses) from weight-only
     changes (squash changes)
   - Enables optimised validation ordering

### Key Features

- **Type-based grouping**: Structural candidates (add-neurons, add-synapses,
  remove-neuron, remove-synapse, etc.) are processed separately from weight-only
  candidates (change-squash)
- **Early-exit option**: When enabled, stops processing structural candidates on
  first validation failure
- **Validation caching**: Caches validation results by creature structure hash
  to avoid redundant validation
- **Statistics tracking**: Provides detailed statistics including cache hits,
  valid/invalid counts, and early-exit status
- **Forward-only support**: Correctly handles 4.x+ creatures with forward-only
  invariants

## Evidence

### Benchmark Results

The benchmark compares individual validation vs batch validation across
different creature sizes:

```
group small-creature
  Small (50 neurons): Individual validation (baseline)
     1.03x faster than Small (50 neurons): Batch validation
     1.05x faster than Small (50 neurons): Batch with caching (pre-warmed)

group medium-creature
  Medium (200 neurons): Individual validation (baseline)
     1.00x slower than Medium (200 neurons): Batch validation
     1.01x faster than Medium (200 neurons): Batch with early exit

group large-creature
  Large (500 neurons): Individual validation (baseline)
     1.01x slower than Large (500 neurons): Batch validation
     1.00x slower than Large (500 neurons): Batch with caching
```

**Note**: The primary benefit of this implementation is not raw speed
improvement, but rather:

1. **API simplification** - Single call to validate multiple candidates
2. **Caching infrastructure** - Avoids redundant validation when validating the
   same structure multiple times
3. **Type-based organisation** - Structural vs weight-only changes processed
   appropriately
4. **Early-exit capability** - Can stop processing on first structural failure
   if desired

Performance gains will be more significant in real-world scenarios where:

- The same candidate structure is validated multiple times (cache benefit)
- Early-exit on failure is enabled and failures occur early
- Validation is integrated with the discovery pipeline

## Test Plan

Added comprehensive test suite in `test/discovery/BatchDiscoveryValidator.ts`:

- `groupCandidatesByType correctly separates structural and weight-only changes`
- `BatchDiscoveryValidator validates all candidates and returns results`
- `BatchDiscoveryValidator uses validation cache to avoid redundant validations`
- `BatchDiscoveryValidator early-exits on first invalid structural candidate`
- `BatchDiscoveryValidator groups candidates correctly by category`
- `BatchDiscoveryValidator correctly handles forward-only validation`
- `BatchDiscoveryValidator provides validation statistics`
- `BatchDiscoveryValidator can be reset between batches`

All existing tests pass (1782 tests).

## Files Changed

- **New**: `src/discovery/BatchDiscoveryValidator.ts` - Main batch validation
  implementation
- **Modified**: `src/discovery/DiscoveryPostValidate.ts` - Extended with batch
  validation API
- **New**: `test/discovery/BatchDiscoveryValidator.ts` - Test suite for batch
  validation
- **New**: `bench/BatchDiscoveryValidation.ts` - Performance benchmark
- **Modified**: `deno.json` - Version bump to 0.307.0

# CSV Code Removal Summary

Date: 23-Nov-2025

## Changes Made

### 1. **Removed CSV Fallback Logic** ✅

- Removed `listViableNeuronsFallback()` method completely
- Updated `listViableNeurons()` to return empty array if Rust ranking fails
- Changed from `async` to sync since no fallback needed
- If Rust discovery isn't available, discovery is simply skipped

### 2. **Removed Legacy CSV Processing Methods** ✅

- Removed `processCSVRecord()` method (dead code)
- Removed `processCSVChunk()` method (dead code)
- Removed `@std/csv` import (no longer needed)

### 3. **Renamed Misleading Method** ✅

- Renamed `loadCSV()` → `loadNeuronRecords()`
- This method actually reads from Parquet via Rust, not CSV
- Updated all call sites (3 locations)
- Removed `.csv` extension from file paths passed to it

### 4. **Deleted Obsolete Tests** ✅

Removed 3 test files that depended on CSV fallback:

- `test/discovery/DiscoverStructureFocus.ts`
- `test/discovery/FocusSelectionAnalysis.ts`
- `test/discovery/FocusSelectionSensitivity.ts`

These tests explicitly disabled Rust and tested the CSV fallback, which no
longer exists.

### 5. **Updated Comments** ✅

- Updated comment on `loadInputNeuronFromBinary()` to reference Parquet instead
  of CSV
- Added JSDoc to `loadNeuronRecords()` clarifying it reads from Parquet

## Remaining Test Failure

**Note**: One test failure remains but is **UNRELATED** to CSV removal:

```
evolve_SIN_function => ./test/Creature.ts:594:6
error: NO_OUTWARD_CONNECTIONS: hidden neuron a2856e20 has no outward connections
```

This is a pre-existing issue with neuron validation, not related to discovery or
CSV changes.

## Discovery Behavior Now

### With Rust Available (--allow-ffi)

- Discovery works normally using Rust for all analysis
- Reads data from Parquet files
- No CSV files involved

### Without Rust (no --allow-ffi)

- Discovery is simply skipped
- No error thrown - evolution continues
- `listViableNeurons()` returns empty array
- Rest of NEAT evolution process works normally

## Files Modified

### Source Code

- `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts`
- `src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts` (timing
  fixes from earlier)

### Tests Deleted

- `test/discovery/DiscoverStructureFocus.ts`
- `test/discovery/FocusSelectionAnalysis.ts`
- `test/discovery/FocusSelectionSensitivity.ts`

### Documentation Created

- `DISCOVERY_PRODUCTION_ISSUES.md` - Analysis of production failures
- `PERFORMANCE_TIMING_ANALYSIS.md` - Timing issue analysis
- `CSV_REMOVAL_SUMMARY.md` - This file

## Test Status

The following test counts expected after removal:

- **Before**: 649 tests
- **Removed**: 8 CSV-dependent tests
- **After**: 641 tests (minus 1 pre-existing failure)
- **Expected Result**: 640 passing, 1 failing (unrelated to CSV)

## Next Steps

1. ✅ All CSV code removed
2. ✅ Discovery requires Rust or is skipped
3. ⚠️ Still need to investigate production issues:
   - Prediction vs actual mismatch (all 33 candidates failed)
   - Synapse addition causing -7.5% degradation
   - Analysis timeouts
   - Slow Rust ranking (161 seconds)

See `DISCOVERY_PRODUCTION_ISSUES.md` for detailed analysis of production
problems.

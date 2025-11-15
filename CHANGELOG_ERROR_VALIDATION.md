# Error Validation Improvements

## Date: 15-Nov-2024

## Problem

Discovery was failing with an "Invalid string length" error when processing 20
samples with 449 hidden neurons. The diagnostics showed impossibly large error
counts:

- **totalErrorValues**: 247,030,102 (for only 20 samples!)
- **maxErrorValuesPerNeuron**: 1,020,488 (for a single neuron!)

With 20 samples and 449 neurons, we should have approximately:

- ~8,980 neuron records (20 × 449)
- ~20-200 errors per neuron (assuming 1-10 errors per sample)
- Total errors in the tens of thousands range, not hundreds of millions!

The error counts were ~27,500 errors per neuron record, which is physically
impossible given the network topology and backpropagation logic.

## Root Cause Analysis

The issue indicates data corruption somewhere in the TypeScript error recording
logic **before** data is sent to Rust. The Rust side was correctly reporting
these impossible numbers, but the corruption was happening upstream.

## Solution

Added comprehensive validation to detect and crash early when data corruption
occurs, rather than attempting to send corrupted data to Rust:

### 1. Per-Neuron Validation

**Logic**: Maximum errors per neuron = `max(50, sampleCount × outputCount × 3)`

- During backpropagation, each neuron's `record()` is called **once per sample
  per output**
- Each call to `record()` pushes **ONE** error value to the errors array
- A neuron should have approximately `sampleCount × outputCount` errors
- Multiplier of 3 accounts for complex/recurrent network paths
- Minimum of 50 for very small sample sizes (e.g., 10 samples)

**Example with your data**:

- 20 samples, 1 output → max = max(50, 20×1×3) = **60 errors per neuron**
- Actual: 1,020,488 errors → **CRASH with clear error message**

This is **much stricter** than the previous validation, reflecting the actual
backpropagation logic where `record()` should only be called once per sample per
output.

### 2. Total Errors Validation

**Logic**: Maximum total =
`totalNeuronRecords × max(50, sampleCount × outputCount × 3)`

- Ensures overall error count is consistent with per-neuron limits
- Catches cases where individual neurons pass but total is impossible

**Example with your data**:

- 8,980 neuron records × 60 max = **538,800 total errors max**
- Actual: 247,030,102 errors → **CRASH with clear error message**

### 3. Warning Thresholds

- Warns if a neuron has more than `sampleCount × outputCount × 1.5` errors
- Helps identify cases where `record()` is being called too many times per
  sample
- Example: >30 errors per neuron with 20 samples, 1 output (expected: ~20)
- Warning message specifically mentions that `record()` should be called once
  per output per sample

## Files Modified

1. **`src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts`**
   - Added per-neuron validation in `computeRustRecordStats()`
   - Added total errors validation
   - Based on sample count and output count, not neuron count

2. **`src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts`**
   - Added per-record validation in `observeRustTrainingRecordInternal()`
   - Validates each neuron as records are processed
   - Catches corruption immediately, not at flush time

3. **`test/ErrorGuidedStructuralEvolution/RustDiscoveryErrorValidation.test.ts`**
   - New comprehensive test suite
   - Tests rejection of excessive errors
   - Tests acceptance of reasonable error counts
   - Covers edge cases (100 errors at limit, 101 over limit, etc.)

## Error Messages

When corruption is detected, the system now provides clear diagnostic
information:

```
❌ CRITICAL: Neuron hidden-X has 1020488 errors, which exceeds reasonable maximum (60)!
This indicates data corruption in the TypeScript logic.
Samples: 20, Outputs: 1, Max per neuron: 60
Errors array sample (first 10): [...]

Error: Data corruption detected: neuron hidden-X has 1020488 errors, which far exceeds 
reasonable maximum (60). With 20 samples and 1 outputs, this is impossible and indicates 
a bug in error recording.
```

The error message also includes a reminder about the expected behavior:

```
During backprop, record() should be called once per sample per output. 
This indicates record() is being called too many times.
```

## Next Steps

This validation will **crash immediately** when the corruption occurs, making it
much easier to:

1. **Identify the exact location** where errors are being incorrectly
   accumulated
2. **Inspect the data** at the point of failure (via the error array sample in
   logs)
3. **Debug the root cause** in the TypeScript error recording logic

The actual bug causing the corruption still needs to be found and fixed, but now
we have:

- Clear evidence it's in the TypeScript side
- Immediate failure with diagnostic information
- Protection against sending garbage data to Rust

## Testing

All tests pass:

- ✅ New validation tests (6 tests)
- ✅ Existing discovery tests
- ✅ Linting and formatting

Run the failing discovery again - it will now crash with a clear error message
pointing to the corrupted neuron and sample.

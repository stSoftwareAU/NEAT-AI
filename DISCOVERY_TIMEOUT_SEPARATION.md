# Discovery Timeout Separation Fix

## Problem

Discovery was failing to analyze recorded data because a **single timeout** covered both phases:

```
Recording phase: 7m 9s (processing 20 records)
Analysis phase: 0 seconds - TIMED OUT before processing ANY neurons (0/469 processed)
Result: 0 candidates found for all analyses
```

When recording consumed the entire timeout, analysis had no time left and exited immediately with:
```
Discovery timeout reached while listing neurons (0/469 processed)
```

## Solution

**Separate timeouts for each phase:**

1. **Recording Phase** - Times out based on `discoveryTimeOutMinutes` 
   - Prevents spending forever collecting data
   - Can exit early with partial data

2. **Analysis Phase** - Gets **fresh timeout allocation** via `discoveryAnalysisTimeoutMinutes`
   - Guaranteed time to analyze whatever was recorded
   - Default: 3 minutes (configurable)
   - Timeout is **reset** after recording completes

## Implementation

### 1. New Config Option

**`NeatOptions.discoveryAnalysisTimeoutMinutes`**
- Default: 3 minutes
- Allocates dedicated time for analysis after recording completes

### 2. DiscoverStructure Enhancement

```typescript
public extendTimeoutForAnalysis(analysisTimeSeconds: number): void {
  this.timeoutTS = Date.now() + analysisTimeSeconds * 1000;
}
```

Resets the timeout clock to give analysis a fresh time allocation.

### 3. DiscoverDirectory Flow

```typescript
// Recording phase completes (may timeout)
const recordTime = Date.now() - startTime;
console.log(`Discovery recorded time ${recordTime}`);

// RESET TIMEOUT for analysis phase
const analysisTimeoutMinutes = options.discoveryAnalysisTimeoutMinutes || 3;
discoverStructure.extendTimeoutForAnalysis(analysisTimeoutMinutes * 60);

console.log(`Discovery analysis timeout extended by ${analysisTimeoutMinutes}m`);

// Analysis phase runs with guaranteed time
await discoverStructure.analyze(...);
await discoverStructure.analyzeSynapsesForRemoval(...);
await discoverStructure.analyzeNeuronsSquashes(...);
```

## Expected Behavior

### Before Fix
```
Discovery recording: 7m 9s
Discovery timeout reached while listing neurons (0/469 processed)
Discovery found 0 candidates
```

### After Fix
```
Discovery recording: 7m 9s
Discovery analysis timeout extended by 3m
Discovery analyze time: 45s found 3 candidates
Discovery analyze harmful time: 30s found 0 candidates
Discovery analyze squashes time: 20s found 2 candidates
```

## Configuration

Users can customize analysis timeout:

```typescript
const neat = new Neat(inputs, outputs, {
  discoveryTimeOutMinutes: 5,        // Recording phase timeout
  discoveryAnalysisTimeoutMinutes: 3 // Analysis phase timeout (NEW)
});
```

## Files Changed

1. `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts`
   - Added `extendTimeoutForAnalysis()` method

2. `src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts`
   - Calls `extendTimeoutForAnalysis()` after recording completes
   - Logs the timeout extension

3. `src/config/NeatOptions.ts`
   - Added `discoveryAnalysisTimeoutMinutes` option

4. `src/config/NeatConfig.ts`
   - Added default value (3 minutes) for new option

## Benefits

✅ **Analysis always runs** - Even if recording times out or runs slow
✅ **No wasted work** - Recorded data is always analyzed
✅ **Predictable behavior** - Analysis gets guaranteed time allocation
✅ **Configurable** - Users can tune both timeouts independently
✅ **Backward compatible** - Default of 3 minutes works for existing code


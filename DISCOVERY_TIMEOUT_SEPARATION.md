# Discovery Timeout Separation Fix

## Problem

Discovery was failing to analyze recorded data because a **single timeout**
covered both phases:

```
Recording phase: 7m 9s (processing 20 records)
Analysis phase: 0 seconds - TIMED OUT before processing ANY neurons (0/469 processed)
Result: 0 candidates found for all analyses
```

When recording consumed the entire timeout, analysis had no time left and exited
immediately with:

```
Discovery timeout reached while listing neurons (0/469 processed)
```

## Solution

**Separate timeouts for each phase:**

1. **Recording Phase** - Times out based on `discoveryTimeOutMinutes`
   - Prevents spending forever collecting data
   - Can exit early with partial data

2. **Analysis Phase** - Gets **fresh timeout allocation** via
   `discoveryAnalysisTimeoutMinutes`
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
  discoveryTimeOutMinutes: 5, // Recording phase timeout
  discoveryAnalysisTimeoutMinutes: 3, // Analysis phase timeout (NEW)
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

✅ **Analysis always runs** - Even if recording times out or runs slow ✅ **No
wasted work** - Recorded data is always analyzed ✅ **Predictable behavior** -
Analysis gets guaranteed time allocation ✅ **Configurable** - Users can tune
both timeouts independently ✅ **Backward compatible** - Default of 3 minutes
works for existing code

## Intelligent Retry Logic (15-Nov-2024)

### Problem

The expensive recording phase could take minutes, but if the randomly selected
neurons didn't yield any discoveries, the entire effort was wasted:

```
Recording phase: 7m 9s (processing 20 records)
Analysis phase: Selected 6 neurons randomly
  - Analyze helpful synapses: found 0 candidates
  - Analyze helpful neurons: found 0 candidates
  - Analyze harmful synapses: found 0 candidates
  - Analyze squashes: found 0 candidates
Result: 0 candidates (wasted 7+ minutes of recording work)
```

The recorded data in the Parquet file was perfectly good, but we only tried one
random set of neurons and gave up.

### Solution

**Retry with different neurons if no candidates found:**

The analysis phase now automatically retries with different randomly selected
neurons if:

1. No candidates were found in the initial analysis
2. Analysis timeout hasn't been reached (`discoveryAnalysisTimeoutMinutes`)
3. There are still untried neurons available

### Implementation

**Retry Loop in DiscoverDirectory:**

```typescript
const attemptedNeurons = new Set<string>();
let retryAttempt = 0;
const maxRetries = 10;

while (retryAttempt <= maxRetries) {
  // Select neurons (weighted by error)
  const focusList = await discoverStructure.selectNeuronsWeightedByError(
    this.discoveryMaxNeurons,
  );

  // Filter out already-attempted neurons
  const newFocusList = focusList.filter((uuid) => !attemptedNeurons.has(uuid));

  // Run all four analysis types on these neurons
  const addHelpfulSynapse = await discoverStructure.analyzeSelectedNeurons(
    newFocusList,
  );
  const addHelpfulNeurons = await discoverStructure.analyzeMissingNeurons(
    newFocusList,
  );
  const removeHarmfulSynapse = await discoverStructure
    .analyzeSelectedNeuronsForRemoval(newFocusList);
  const candidateSquashes = await discoverStructure
    .analyzeSelectedNeuronsSquashes(newFocusList);

  // Check if we found any candidates
  const foundCandidates = Boolean(
    addHelpfulSynapse ||
      addHelpfulNeurons ||
      removeHarmfulSynapse ||
      candidateSquashes,
  );

  if (foundCandidates) {
    break; // Success! Exit retry loop
  }

  // Check if we still have time for another retry
  const timeRemaining = this.timeoutTS - Date.now();
  if (timeRemaining <= 0) {
    break; // Timeout reached, stop retrying
  }

  retryAttempt++;
  // Try again with different neurons...
}
```

### Expected Behavior

**Before Retry Logic:**

```
Discovery recording: 7m 9s
Discovery selected 6 focus neurons in 2s
  - Analyze helpful: found 0 candidates
  - Analyze neurons: found 0 candidates
  - Analyze harmful: found 0 candidates
  - Analyze squashes: found 0 candidates
Total time: 7m 15s
Result: 0 candidates (7+ minutes wasted)
```

**After Retry Logic:**

```
Discovery recording: 7m 9s
Discovery selected 6 focus neurons in 2s
  - Analyze helpful: found 0 candidates
  - Analyze neurons: found 0 candidates
  - Analyze harmful: found 0 candidates
  - Analyze squashes: found 0 candidates
Discovery no candidates found, retrying with different neurons (2m 58s remaining)
Discovery selected 6 focus neurons in 2s (retry 1, 6 already tried)
  - Analyze helpful: found 2 candidates ✓
  - Analyze neurons: found 1 candidate ✓
  - Analyze harmful: found 0 candidates
  - Analyze squashes: found 1 candidate ✓
Discovery found candidates after 1 retry attempt
Total time: 7m 25s
Result: 4 candidates found (recording work not wasted!)
```

### Key Features

1. **Tracks attempted neurons** - Avoids analyzing the same neurons twice
2. **Respects analysis timeout** - Only retries while time remains
3. **Reuses recorded data** - No need to re-record, just analyze different
   neurons
4. **Max retry limit** - Prevents infinite loops (default: 10 retries)
5. **Weighted selection** - Each retry still uses error-weighted selection for
   new neurons
6. **Early exit on success** - Stops immediately when candidates are found

### Benefits

✅ **Maximizes recording investment** - Tries multiple neuron sets using same
recorded data ✅ **Increases discovery success rate** - More chances to find
improvements ✅ **Time-bounded** - Respects `discoveryAnalysisTimeoutMinutes`
limit ✅ **No duplicate work** - Tracks and skips already-analyzed neurons ✅
**Automatic** - No configuration needed, works out of the box ✅ **Minimal
overhead** - Only retries when needed (no candidates found)

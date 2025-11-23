# Discovery Performance Timing Analysis

Date: 23-Nov-2025

## Issues Identified

### A) Missing Times in Performance Report

**Root Cause**: The main Rust analysis computation time is not being measured.

In `DiscoverDirectory.ts` (line 776), the code calls:

```typescript
const combinedResult = discoverStructure.ensureRustCombinedAnalysis(...)
```

This function performs the **heavy Rust computation** (calling either
`analyzeParallel` or `analyzeAll`) but **the time is NOT tracked** in
performance stats.

Later (line 818), the code calls:

```typescript
const candidateBundle = discoverStructure.collectRustAnalysisCandidates(...)
```

This second call is nearly instantaneous (just collecting already-analyzed
results), but THIS is what gets timed as `rustCombinedAnalysisTime`.

**Impact**:

- Rust combined analysis: Shows blank (0ms) because `ensureRustCombinedAnalysis`
  isn't timed
- Neuron analysis: Shows blank because the combined path skips individual
  analysis
- Synapse analysis: Shows blank for the same reason
- Harmful synapse/neuron analysis: Same issue

**The Missing Time**: The actual Rust analysis is likely taking **7-8 minutes**
(the gap between record phase ~1m and squash analysis start, minus the 2m 41s
focus selection time).

### B) Time After "Cleanup Complete"

**Root Cause**: Cleanup happens asynchronously.

Looking at lines 1158-1172 of `DiscoverDirectory.ts`:

- If `shouldAwaitCleanup()` returns `false`, cleanup runs in the background
- The function returns immediately, logging happens later
- `totalTime` is calculated BEFORE cleanup finishes
- The console shows "cleanup complete" from the async promise

**Impact**:

- No missing phase - cleanup is async and may complete after results are
  returned
- Any time between "cleanup complete" and program exit is in the Worker/Handler
  code
- This is likely just logging and response handling overhead

**Potential Missing Phase**: Re-scoring might be happening in the training loop
AFTER discovery returns, not within discovery itself. Check the code that calls
`recordDirectory`.

### C) Focus Selection Taking 2m 41s

**Root Cause**: Time accumulates across multiple retry attempts in the analysis
loop.

Looking at line 739:

```typescript
perfStats.focusSelectionTime += Date.now() - focusSelectStart;
```

The `+=` operator means time is accumulated across all retry attempts.

With 6 neurons analyzed and potentially multiple retries (the output shows
"Retry attempts: 0" but the loop may have run multiple times), the focus
selection calls:

1. `selectNeuronsWeightedByError()` which calls:
   - `listViableNeurons()` - this may call Rust `rankFocusNeurons` OR
   - Fall back to loading CSV files for every neuron (very slow!)
   - `getMaxOutputError()` - may also do file I/O

**Why So Slow**:

- If Rust ranking is failing, it falls back to `listViableNeuronsFallback()`
- This loads CSV files: `loadCSV(\` ${this.tempDir}/${n.uuid}.csv\`)` for EVERY
  neuron
- With a large network, this could mean loading dozens/hundreds of CSV files
- This happens on EVERY retry iteration

## Recommended Fixes

### Fix 1: Measure Rust Combined Analysis Time

In `DiscoverDirectory.ts`, around line 776:

```typescript
// BEFORE
const combinedResult = discoverStructure.ensureRustCombinedAnalysis(
  newFocusList,
  this.enableSynapseCandidates || this.enableHarmfulCandidates,
  this.enableNeuronCandidates,
);

// AFTER
const rustAnalysisStart = Date.now();
const combinedResult = discoverStructure.ensureRustCombinedAnalysis(
  newFocusList,
  this.enableSynapseCandidates || this.enableHarmfulCandidates,
  this.enableNeuronCandidates,
);
const rustAnalysisTime = Date.now() - rustAnalysisStart;
perfStats.rustCombinedAnalysisTime += rustAnalysisTime;
```

And REMOVE or RENAME the timing at line 818-827 since that's just collection,
not analysis.

### Fix 2: Add Detailed Focus Selection Breakdown

In `DiscoverStructure.ts`, add timing inside `selectNeuronsWeightedByError`:

```typescript
public async selectNeuronsWeightedByError(...): Promise<string[]> {
  const timings = {
    listViableNeurons: 0,
    maxOutputError: 0,
    selection: 0,
  };
  
  const start1 = Date.now();
  const neuronErrors = await this.listViableNeurons(count);
  timings.listViableNeurons = Date.now() - start1;
  
  const start2 = Date.now();
  const maxOutputError = await this.getMaxOutputError();
  timings.maxOutputError = Date.now() - start2;
  
  // ... rest of function ...
  
  if (this.loggingEnabled) {
    this.log("debug", `Focus selection breakdown: listViable=${timings.listViableNeurons}ms, maxError=${timings.maxOutputError}ms`);
  }
}
```

### Fix 3: Investigate Why Rust Ranking Might Be Slow

Add diagnostic logging in `tryRustFocusRanking()` to see if Rust is actually
being used:

```typescript
private tryRustFocusRanking(targetCount?: number): NeuronErrorInfo[] | undefined {
  // ... existing checks ...
  
  const start = Date.now();
  const result = this.deps.rankFocusNeurons({...});
  const duration = Date.now() - start;
  
  if (this.loggingEnabled && duration > 1000) {
    this.log("warn", `Rust rankFocusNeurons took ${duration}ms - this seems slow!`);
  }
  
  // ... rest of function ...
}
```

### Fix 4: Improve Async Cleanup Clarity

Update the logging to make it clearer:

```typescript
if (this.shouldAwaitCleanup()) {
  await cleanupPromise;
  if (shouldLogDiscovery(options)) {
    console.log(`Discovery ${blue(this.ID)} cleanup awaited and complete.`);
  }
} else {
  cleanupPromise.catch(...);
  if (shouldLogDiscovery(options)) {
    console.log(`Discovery ${blue(this.ID)} cleanup scheduled (async, non-blocking).`);
  }
}
```

## Expected Results After Fixes

The performance summary should show something like:

```
Analysis Phase:
  Focus selection: 5s 200ms
  Rust combined analysis: 7m 15s 320ms  <-- This was missing!
  Neuron analysis: 
  Synapse analysis: 
  Squash analysis: 51s 819ms
  Total analysis phase: 10m 57s 42ms
```

The focus selection should be much faster (< 10 seconds per iteration).

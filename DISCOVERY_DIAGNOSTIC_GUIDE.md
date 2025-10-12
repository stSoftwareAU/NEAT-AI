# Discovery Diagnostic Guide

## Problem Statement

Discovery processes were not completing (no errors, but also never finishing),
causing the evolution to wait for 20+ generations (~30 minutes) before timing
out.

## Changes Implemented

### 1. Improved Timeout Calculation (Neat.ts)

- **Default Max Wait**: Set to 5 minutes (300 seconds) when not specified
- **Accurate Timing**: Uses actual average time per generation instead of
  hardcoded estimates
- **Parameters Added**: `finishUp()` now accepts `startTimeMS` and
  `currentGeneration` to calculate real timing
- **Smart Calculation**: Automatically determines how many generations fit in 5
  minutes based on actual performance

### 1.5. Anti-Deadlock Protection (DiscoverStructure.ts, DiscoverDirectory.ts)

**CRITICAL IMPROVEMENTS TO PREVENT PROMISE CHAIN DEADLOCKS:**

#### A. Safe File Write Wrapper (`safeFileWrite()`)

- **Timeout Protection**: Each file write has a 30-second timeout
- **Error Handling**: Catches and logs failures without breaking the promise
  chain
- **Non-blocking**: Failed writes don't prevent other neurons from writing
- **Logging**: Clear error messages identify which files fail

#### B. Protected Initialization

- All neuron CSV file creation wrapped with 30-second timeout
- Individual neuron failures don't block initialization
- Error logging for each failed file creation

#### C. Protected Promise.all()

- **60-second timeout** on the critical
  `Promise.all([...neuronPromisesMap.values()])`
- **Race condition protection**: Uses `Promise.race()` to enforce timeout
- **Graceful degradation**: Continues even if some writes fail or timeout
- **Success logging**: Confirms when all writes complete successfully

#### D. Promise Chain Error Handling

- Every `.then()` in the promise chain has a `.catch()` handler
- Errors are logged but don't propagate to break other chains
- Each neuron's file write chain is independent

**Result**: Discovery can no longer hang indefinitely on file I/O operations!

### 2. Comprehensive Diagnostic Logging

Added detailed logging at every stage of the discovery process to pinpoint where
it gets stuck:

#### A. Main Thread (Neat.ts)

- `[Neat] Discovery {uuid} scheduled` - When discovery is queued
- `[Neat] Discovery request sent to worker for {uuid}` - When sent to worker
- `[Neat] Discovery completed for {uuid} after Xs` - When successfully completed
- `[Neat] Discovery failed for creature {uuid} after Xs` - When error occurs
- `[Neat] Waiting for discovery to complete (X/Y) - In progress: {uuids}` -
  During wait period

#### B. Worker Handler (WorkerHandler.ts)

- `[WorkerHandler] Posting discovery request to worker (taskID: X)` - When
  message is posted to worker
- `[WorkerHandler] Received discovery response for taskID: X` - When response is
  received

#### C. Worker Processor (WorkerProcessor.ts)

- `[Worker] Starting discovery for creature (taskID: X)...` - When worker starts
  processing
- `[Worker] Discovery complete for creature (taskID: X), preparing response...` -
  When discovery logic finishes
- `[Worker] Returning discovery response (taskID: X)...` - When response is
  being sent back

#### D. Discovery Implementation (DiscoverDirectory.ts)

- `Discovery {ID} processing {filePath}` - For each file being processed
- `Discovery {ID} scanning time` - After file scanning completes
- `Discovery {ID} waiting for N neuron file write promises to complete...` -
  **CRITICAL: Before Promise.all()**
- `Discovery {ID} recorded time` - After all file writes complete
- `Discovery {ID} starting analyze phase...` - Before synapse analysis
- `Discovery {ID} analyze time` - After synapse analysis
- `Discovery {ID} starting harmful synapse analysis...` - Before harmful
  analysis
- `Discovery {ID} starting squash analysis...` - Before squash analysis
- `Discovery {ID} analysis complete, total time` - After all analysis
- `Discovery {ID} performing cleanup...` - Before cleanup
- `Discovery {ID} cleanup complete.` - After cleanup

### 3. Timeout Safety Mechanism

Added `Promise.race()` with timeout to prevent infinite waiting:

- Automatically times out if no response after the specified discovery timeout
- Default timeout: 60 minutes if not specified
- Error message clearly indicates timeout occurred

## How to Diagnose the Issue

### Step 1: Enable Logging

Make sure you have logging enabled in your NeatOptions:

```typescript
{
  log: 1,  // or higher for more frequent logging
  verbose: true  // for main thread logging
}
```

### Step 2: Watch for Log Sequence

When discovery runs, you should see logs in this order:

1. **Scheduling Phase**:
   ```
   [Neat] Discovery {uuid} scheduled
   [Neat] Discovery request sent to worker for {uuid}
   ```

2. **Communication Phase**:
   ```
   [WorkerHandler] Posting discovery request to worker (taskID: X)
   [Worker] Starting discovery for creature (taskID: X)...
   ```

3. **Processing Phase**:
   ```
   Discovery {ID} with N binary files, sample rate: X%, batch size: Y
   Discovery {ID} initialize time
   Discovery {ID} processing file1.bin
   Discovery {ID} processing file2.bin
   ...
   Discovery {ID} scanning time
   ```

4. **Critical Wait Point** (MOST LIKELY TO HANG):
   ```
   Discovery {ID} waiting for N neuron file write promises to complete...
   ```
   - If you see this log but never see "recorded time", the file write promises
     are stuck!

5. **Analysis Phase**:
   ```
   Discovery {ID} recorded time
   Discovery {ID} starting analyze phase...
   Discovery {ID} analyze time
   Discovery {ID} starting harmful synapse analysis...
   Discovery {ID} starting squash analysis...
   ```

6. **Completion Phase**:
   ```
   Discovery {ID} analysis complete, total time
   Discovery {ID} performing cleanup...
   Discovery {ID} cleanup complete.
   [Worker] Discovery complete for creature (taskID: X), preparing response...
   [Worker] Returning discovery response (taskID: X)...
   [WorkerHandler] Received discovery response for taskID: X
   [Neat] Discovery completed for {uuid} after Xs
   ```

### Step 3: Identify Where It Hangs

The **last log message** you see before the hang tells you where the problem is:

| Last Log Seen                              | Problem Location            | Likely Cause                                        |
| ------------------------------------------ | --------------------------- | --------------------------------------------------- |
| `Discovery request sent to worker`         | Worker communication        | Worker not receiving messages or crashed            |
| `Posting discovery request to worker`      | Worker thread               | Worker thread not starting or message queue blocked |
| `Starting discovery for creature`          | Discovery initialization    | recordDirectory() failing before logging            |
| `Discovery ID initialize time`             | File processing             | getBinaryFiles() or file reading failing            |
| `processing {file}`                        | File read loop              | File read hanging or timeout check failing          |
| `scanning time`                            | **CRITICAL: Promise.all()** | **File write promises never resolving!**            |
| `waiting for N neuron file write promises` | **CRITICAL: File I/O**      | **Deno.writeTextFile() calls are hanging!**         |
| `recorded time`                            | Analysis phase              | analyze() method hanging                            |
| `starting analyze phase`                   | Synapse analysis            | CSV loading or analysis computation hanging         |
| `analyze time`                             | Harmful synapse analysis    | analyzeSynapsesForRemoval() hanging                 |
| `starting harmful synapse analysis`        | Squash analysis             | analyzeNeuronsSquashes() hanging                    |
| `analysis complete`                        | Cleanup phase               | discoverStructure.cleanUp() hanging                 |
| `performing cleanup`                       | Directory removal           | Deno.remove() hanging on temp directory             |

### Step 4: Most Likely Root Causes

Based on the log patterns, the most likely issues are:

1. **File Write Deadlock** (if stuck at "waiting for N neuron file write
   promises"):
   - The chained promises for file writes may have a broken promise chain
   - Check `DiscoverStructure.record()` method around line 142-221
   - Issue: If any promise in the chain rejects or never resolves, the entire
     Promise.all() hangs

2. **Worker Communication Breakdown**:
   - If you see "Posting discovery request" but never "Starting discovery"
   - The worker thread might not be receiving messages
   - Check worker initialization and message handler setup

3. **File System I/O Hang**:
   - If stuck during file processing
   - Deno file operations might be blocking on large files
   - Check file permissions or disk I/O issues

4. **Cleanup Hanging**:
   - If stuck at "performing cleanup"
   - Directory removal might be blocked by open file handles
   - Check that all files are properly closed

## Expected Behavior After Fix

### If the Root Cause Was Promise Chain Deadlock:

You will now see:

- Discovery completes successfully OR
- Clear error messages like:
  - `[DiscoverStructure] File write failed for {file}:` - Identifies specific
    file write failures
  - `[DiscoverStructure] Promise chain failed for neuron {uuid}:` - Identifies
    broken promise chains
  - `Discovery {ID} file writes failed or timed out:` - Identifies when
    Promise.all() times out
- Discovery will continue and complete even if some file writes fail
- Evolution will NOT hang waiting for stuck promises

### With the new 5-minute generation-based timeout:

- Discovery should complete within a reasonable time OR
- Timeout after max 5 minutes (or specified discoveryTimeOutMinutes)
- Clear error message indicating what timed out
- Evolution continues instead of hanging indefinitely

### What Changed to Prevent Deadlock:

**Before**: A single stuck promise in the chain → entire Promise.all() hangs
forever **After**: Individual timeouts + error handling → continues with partial
data or fails fast with clear errors

## Next Steps

1. Run your evolution with logging enabled
2. Observe which log message is the last one before hanging
3. Report back with the specific log sequence
4. We can then target the exact problematic code section

## Additional Notes

- The timeout mechanism in `scheduleDiscovery()` now uses `Promise.race()` to
  forcefully fail if discovery takes too long
- The generation-based wait in `finishUp()` is now more accurate and bounded to
  5 minutes by default
- All file I/O operations should have their promise chains validated to ensure
  proper resolution

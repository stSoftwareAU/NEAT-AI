# Discovery Diagnostic Tracking

## Purpose

This document explains the enhanced diagnostic tracking added to identify
**exactly** where discovery hangs, since the original assumption about disk I/O
may not be correct.

## What Was Added

### Promise Completion Tracking

The code now tracks **which specific promises complete** and which don't:

```typescript
// Track promise completion for diagnostics
const promiseTracker = new Map<
  string,
  { completed: boolean; startTime: number }
>();
const trackedPromises = new Map<string, Promise<void>>();

for (const [neuronUUID, promise] of neuronPromisesMap.entries()) {
  promiseTracker.set(neuronUUID, { completed: false, startTime: Date.now() });

  // Wrap each promise to track completion
  const trackedPromise = promise.then(() => {
    const tracker = promiseTracker.get(neuronUUID);
    if (tracker) {
      tracker.completed = true;
    }
  }).catch((error) => {
    const tracker = promiseTracker.get(neuronUUID);
    if (tracker) {
      tracker.completed = true; // Mark as "done" even if errored
    }
  });

  trackedPromises.set(neuronUUID, trackedPromise);
}
```

### Detailed Phase Logging

Added logging at **every major phase** to see where execution stops:

1. **Initialization Phase**
   ```
   Discovery {ID} initializing {N} neurons...
   Discovery {ID} initialize time {T} - created {N} promises
   ```

2. **File Processing Phase**
   ```
   Discovery {ID} starting file processing loop for {N} files...
   Discovery {ID} file processing complete, recording final batch...
   Discovery {ID} scanning time {T}
   ```

3. **Promise Wait Phase**
   ```
   Discovery {ID} waiting for {N} neuron file write promises to complete...
   Discovery {ID} all file writes completed successfully.
   ```
   OR on timeout:
   ```
   ❌ DISCOVERY DEADLOCK DIAGNOSTIC for {ID}:
      Total promises: {N}
      Completed: {N}
      Still pending: {N}
      Pending neuron UUIDs:
         - {uuid} (waiting {T}s)
         - ...
   ```

4. **Analysis Phases**
   ```
   Discovery {ID} starting analyze phase (max {N} neurons)...
   Discovery {ID} starting harmful synapse analysis...
   Discovery {ID} starting squash analysis...
   ```

## What You'll See When It Hangs

### Scenario 1: Hangs During File Processing

```
Discovery abc12345 initializing 1967 neurons...
Discovery abc12345 initialize time 50ms - created 1967 promises
Discovery abc12345 starting file processing loop for 50 files...
(HANGS HERE - no more messages)
```

**Diagnosis**: The file processing loop (`processFile`) is hanging

### Scenario 2: Hangs During Promise.all()

```
Discovery abc12345 scanning time 5s
Discovery abc12345 waiting for 1967 neuron file write promises to complete...
(HANGS HERE - waits 60 seconds, then...)
❌ DISCOVERY DEADLOCK DIAGNOSTIC for abc12345:
   Total promises: 1967
   Completed: 1890
   Still pending: 77
   Pending neuron UUIDs:
      - hidden-234 (waiting 60.0s)
      - hidden-567 (waiting 60.0s)
      - ...
```

**Diagnosis**: Specific file write promises never completed - those neuron UUIDs
are listed

### Scenario 3: Hangs During Analysis

```
Discovery abc12345 all file writes completed successfully.
Discovery abc12345 recorded time 10s
Discovery abc12345 starting analyze phase (max 6 neurons)...
(HANGS HERE - no more messages)
```

**Diagnosis**: The `analyze()` method is hanging (not disk I/O)

### Scenario 4: Hangs During Harmful Synapse Analysis

```
Discovery abc12345 analyze time 2s found 3 candidates
Discovery abc12345 starting harmful synapse analysis...
(HANGS HERE - no more messages)
```

**Diagnosis**: The `analyzeSynapsesForRemoval()` method is hanging

### Scenario 5: Hangs During Squash Analysis

```
Discovery abc12345 analyze harmful time 1s found 0 candidates
Discovery abc12345 starting squash analysis...
(HANGS HERE - no more messages)
```

**Diagnosis**: The `analyzeNeuronsSquashes()` method is hanging

## How to Use This

1. **Run your evolution with `log: 1` and `verbose: true`**:
   ```typescript
   {
     log: 1,
     verbose: true,
     // ... other options
   }
   ```

2. **When discovery times out, look at the console output**

3. **Find the LAST log message before the hang**

4. **Match it to the scenarios above** to identify the exact hanging point

5. **Report back with**:
   - The last log message you saw
   - The diagnostic output (especially the pending neuron UUIDs if available)
   - How long it took to timeout

## Key Questions This Answers

- ✅ **Are we reaching Promise.all()?** If you don't see "waiting for N neuron
  file write promises", we're hanging before that
- ✅ **Are ALL promises completing?** The diagnostic shows exact count of
  completed vs pending
- ✅ **Which specific neurons are stuck?** The pending neuron UUIDs tell us
  exactly which file writes didn't complete
- ✅ **Is it disk I/O or analysis?** If all file writes complete but it hangs on
  "starting analyze phase", it's not disk I/O
- ✅ **How long do successful operations take?** The timing info helps identify
  if something is unusually slow

## Next Steps Based on Results

### If Pending Promises Are Shown

The issue IS with file writes. Those specific neuron UUIDs are stuck. Possible
causes:

- Promise chain logic bug for specific neurons
- File system issue for specific files
- Memory corruption for specific neuron data

### If "All File Writes Completed" But Hangs After

The issue is NOT disk I/O. It's in the analysis phase:

- Check `analyze()` method
- Check `analyzeSynapsesForRemoval()` method
- Check `analyzeNeuronsSquashes()` method
- Look for infinite loops or blocking operations in analysis code

### If Hangs Before "Waiting for Promises"

The issue is in the file processing or recording phase:

- Check `processFile()` method
- Check `record()` method
- Look for infinite loops in data processing

## Files Modified

- `src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts`
  - Added promise completion tracking (lines 272-294)
  - Added detailed diagnostic output on timeout (lines 323-351)
  - Added phase logging throughout `recordFiles()` method

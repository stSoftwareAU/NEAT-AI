# Discovery Deadlock Prevention - Summary

## The Problem

Discovery processes were hanging indefinitely with no errors, waiting for 20+
generations (~30 minutes).

## Root Cause Hypothesis

**Promise chain deadlock** in file write operations:

- Each neuron has a chain of promises for sequential file writes
- Promises are chained: `previousPromise.then(() => writeFile())`
- If ANY promise fails to resolve → entire `Promise.all()` hangs forever
- No error handling → silent failure

## The Fix - Multi-Layer Protection

### Layer 1: Individual File Write Timeouts

```typescript
safeFileWrite(fileName, data, timeoutMS = 30000);
```

- Each file write operation has a 30-second timeout
- Uses `Promise.race([writePromise, timeoutPromise])`
- Catches errors and logs them without breaking the chain
- **Prevents**: A single slow/stuck write from blocking everything

### Layer 2: Promise Chain Error Handlers

```typescript
previousPromise.then(() => this.safeFileWrite(fileName, data))
  .catch((error) => {
    console.error(`Promise chain failed for neuron ${uuid}:`, error);
    // Don't rethrow - allow other neurons to continue
  });
```

- Every `.then()` has a matching `.catch()`
- Errors are logged but don't propagate
- Each neuron's chain is independent
- **Prevents**: One failed neuron from breaking others

### Layer 3: Promise.all() Timeout

```typescript
const allWritesPromise = Promise.all([...neuronPromisesMap.values()]);
const writeTimeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error("60s timeout")), 60000);
});
await Promise.race([allWritesPromise, writeTimeoutPromise]);
```

- 60-second timeout on the entire Promise.all()
- Continues even if timeout occurs
- **Prevents**: Infinite waiting if promise chain somehow still hangs

### Layer 4: Discovery-Level Timeout

```typescript
const timeoutMS = (timeOutMinutes > 0 ? timeOutMinutes : 60) * 60 * 1000;
Promise.race([discoveryPromise, timeoutPromise]);
```

- Entire discovery operation has a timeout (default 60 minutes)
- Forcefully fails and clears if timeout reached
- **Prevents**: Worker-level hangs from blocking evolution

### Layer 5: Generation-Based Timeout

```typescript
maxDiscoveryWaitGenerations = Math.floor(5_MINUTES / avgTimePerGeneration)
```

- Evolution only waits max 5 minutes (configurable)
- Uses actual generation timing, not estimates
- Clears stuck discoveries after timeout
- **Prevents**: Evolution from waiting indefinitely for discovery

## What This Fixes

| Scenario             | Before                             | After                                     |
| -------------------- | ---------------------------------- | ----------------------------------------- |
| File write hangs     | Entire discovery deadlocks forever | 30s timeout → error logged → continues    |
| Promise chain breaks | Silent hang, no errors             | Error logged, other neurons continue      |
| Promise.all() stuck  | Infinite wait                      | 60s timeout → continues with partial data |
| Worker hangs         | 20+ generations (~30 min) wait     | 5 minutes max wait → clears & continues   |
| Disk I/O slow        | No timeout, waits forever          | Multiple timeout layers ensure progress   |

## Testing Strategy

### Scenario 1: If Discovery Now Completes

✅ The promise chain deadlock was the issue

- Discovery will finish successfully
- No error messages (all writes succeeded)
- Evolution continues normally

### Scenario 2: If You See File Write Errors

🔍 Identifies the specific problem

- Error messages will show which files/neurons failed
- Discovery continues anyway with partial data
- You can investigate specific file I/O issues

### Scenario 3: If Discovery Still Hangs

🔍 The issue is elsewhere

- Check which timeout triggers (logged clearly)
- The diagnostic logging will show exactly where it hangs
- Refer to DISCOVERY_DIAGNOSTIC_GUIDE.md for interpretation

## Error Messages to Watch For

| Error Message                                                 | Meaning                             | Action                                    |
| ------------------------------------------------------------- | ----------------------------------- | ----------------------------------------- |
| `File write timeout: {file} took longer than 30s`             | Specific file write is slow/stuck   | Check disk I/O, file size, permissions    |
| `Promise chain failed for neuron {uuid}`                      | Promise chain broke for this neuron | Check error details, may be file-specific |
| `File writes timeout: N promises did not complete within 60s` | Multiple writes are stuck           | Systemic I/O issue or too many neurons    |
| `Discovery timeout: No response after X minutes`              | Entire worker hung or stuck         | Worker-level issue, not file I/O          |
| `[Neat] Discovery timeout reached after N generations`        | Generation-based timeout            | Discovery taking too long overall         |

## Configuration Options

To adjust timeouts if needed:

```typescript
// In DiscoverStructure.safeFileWrite() - default 30s per write
private safeFileWrite(fileName, data, timeoutMS = 30000)

// In DiscoverDirectory.recordFiles() - default 60s for all writes
setTimeout(() => reject(...), 60000)

// In Neat.scheduleDiscovery() - default 60 minutes or from config
const timeoutMS = (timeOutMinutes > 0 ? timeOutMinutes : 60) * 60 * 1000

// In Neat.finishUp() - default 5 minutes max wait
const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000
```

## Performance Impact

- **Minimal overhead**: Timeouts only fire if there's actually a problem
- **Better resource usage**: Doesn't hold onto stuck promises indefinitely
- **Faster failure**: Issues surface in 30-60 seconds instead of 30+ minutes
- **Graceful degradation**: Continues with partial data instead of complete
  failure

## Next Steps

1. **Run your evolution** with `log: 1` and `verbose: true`
2. **Watch for any of the error messages** above
3. **Report back**:
   - If discovery completes successfully → deadlock was the issue! ✅
   - If you see errors → we've identified the specific problem 🔍
   - If still hangs → check the logs and refer to diagnostic guide 📊

The anti-deadlock measures ensure that even if discovery fails, it fails **fast
and clearly** instead of hanging silently.

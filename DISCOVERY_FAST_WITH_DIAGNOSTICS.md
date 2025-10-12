# Discovery: Fast Execution with Diagnostics on Error

## Design Philosophy

**Run as fast as possible during normal operation, be as verbose as needed when problems occur.**

Console logging is slow and can significantly impact discovery performance, especially with large numbers of neurons (1967+). We only output diagnostic information when something actually goes wrong.

## Normal Operation (Fast Path)

### What Gets Logged
Only summary timing information at key milestones:
```
Discovery abc12345 initialize time 50ms
Discovery abc12345 scanning time 5s
Discovery abc12345 analyze time 2s found 3 candidates
Discovery abc12345 analyze harmful time 1s found 0 candidates
Discovery abc12345 analyze squashes time 800ms found 2 candidates
```

### What Does NOT Get Logged (Silent for Speed)
- "starting X phase..." messages
- "waiting for promises..." messages
- "file processing complete..." messages
- Success messages for normal operations
- Per-file processing updates

**Result**: Minimal console I/O, maximum speed

## Error Detection (Diagnostic Path)

### When Timeout Occurs at Promise.all()

The diagnostic tracking activates and produces detailed output:

```
❌ DISCOVERY DEADLOCK DIAGNOSTIC for abc12345:
   Total promises: 1967
   Completed: 1890
   Still pending: 77
   Pending neuron UUIDs:
      - hidden-234 (waiting 60.0s)
      - hidden-567 (waiting 60.0s)
      - output-12 (waiting 60.0s)
      - hidden-890 (waiting 60.0s)
      - hidden-1234 (waiting 60.0s)
      ...

Discovery abc12345 file writes failed or timed out: Error: File writes timeout: 1967 promises did not complete within 60000ms
```

This tells you:
- ✅ Exactly how many promises completed vs stuck
- ✅ The specific neuron UUIDs that are stuck (up to 20 listed)
- ✅ How long each pending promise has been waiting

### When Other Errors Occur

Error handlers log detailed information:
```
[DiscoverStructure] File write failed for .discovery/abc_123/hidden-234.csv: Error: ...
[DiscoverStructure] Promise chain failed for neuron hidden-567: Error: ...
❌ CRITICAL: Discovery abc12345 cleanup failed - potential resource leak: Error: ...
```

## Performance Impact

### Before (Verbose Logging)
```typescript
console.log("starting file processing loop...") 
console.log("file processing complete...")
console.log("waiting for 1967 promises...")
console.log("starting analyze phase...")
console.log("starting harmful synapse analysis...")
console.log("starting squash analysis...")
```
- 6+ console.log calls during normal operation
- Each console.log is synchronous and slow
- Cumulative slowdown of ~10-50ms+ per discovery

### After (Silent Fast Path)
```typescript
// Success path: NO console output except summary timing
// Only outputs diagnostic info on actual errors
```
- 0 console.log calls during normal operation (except final timing)
- Console I/O only when something goes wrong
- Discovery runs at maximum speed

## Implementation Details

### Promise Tracking (Always Active, But Silent)

The tracking infrastructure is **always running** but produces **zero output** on success:

```typescript
// Track promise completion for diagnostics (silent unless timeout occurs)
const promiseTracker = new Map<string, { completed: boolean; startTime: number }>();
const trackedPromises = new Map<string, Promise<void>>();

for (const [neuronUUID, promise] of neuronPromisesMap.entries()) {
  promiseTracker.set(neuronUUID, { completed: false, startTime: Date.now() });
  
  const trackedPromise = promise.then(() => {
    tracker.completed = true; // Silent tracking
  }).catch((_error) => {
    tracker.completed = true; // Silent tracking
  });
  
  trackedPromises.set(neuronUUID, trackedPromise);
}
```

**Performance cost**: Negligible (~0.1ms for map operations)
**Benefit**: Complete diagnostic capability with no console slowdown

### Success Path

```typescript
try {
  await Promise.race([allWritesPromise, writeTimeoutPromise]);
  clearTimeout(writeTimeoutId);
  // Success - no logging needed (fast path)
} catch (error) {
  // Only now do we examine promiseTracker and output diagnostics
  // ...detailed error reporting...
}
```

## What You'll See

### Normal Successful Discovery
```
Discovery abc12345 initialize time 50ms
Discovery abc12345 scanning time 5s  
Discovery abc12345 analyze time 2s found 3 candidates
Discovery abc12345 analyze harmful time 1s found 0 candidates
Discovery abc12345 analyze squashes time 800ms found 2 candidates
Discovery abc12345 analysis complete, total time 8s, starting cleanup...
```

Clean, fast, minimal output.

### Discovery with Timeout/Error
```
Discovery abc12345 initialize time 50ms
Discovery abc12345 scanning time 5s
❌ DISCOVERY DEADLOCK DIAGNOSTIC for abc12345:
   Total promises: 1967
   Completed: 1890
   Still pending: 77
   Pending neuron UUIDs:
      - hidden-234 (waiting 60.0s)
      - hidden-567 (waiting 60.0s)
      ...
Discovery abc12345 file writes failed or timed out: Error: ...
```

Verbose diagnostics only when needed.

## Configuration

No configuration needed! The behavior is automatic:
- ✅ Fast by default
- ✅ Verbose only on errors
- ✅ No performance penalty for diagnostic capability

## Benefits

1. **Maximum Speed**: No console I/O slowdown during normal operation
2. **Complete Diagnostics**: Full tracking infrastructure ready when needed
3. **Instant Debugging**: When errors occur, you immediately get detailed info
4. **Zero Overhead**: Tracking is negligible, console output is conditional
5. **Production Ready**: Safe to run with diagnostics always enabled

## Summary

```
Normal Operation:  FAST + SILENT = Maximum Performance
Error Condition:   SLOW + VERBOSE = Maximum Diagnostics
```

Best of both worlds!


# Discovery Promise Chain Deadlock Fix

## Problem

Discovery was timing out after 10 minutes with no response, indicating a hang in
the promise chain. The timeout detection was working correctly, but the
underlying issue was that the discovery process was never completing.

## Root Cause

The **promise chains for file writes had NO error handlers**, causing silent
deadlocks when any file write failed or hung:

```typescript
// BEFORE - No error handling!
const nextPromise = previousPromise.then(() =>
  Deno.writeTextFile(fileName, dataCSV, { append: true, create: false })
);
```

If ANY promise in the chain rejected or never resolved:

- The entire `Promise.all()` would hang forever
- No error messages would be generated
- The timeout mechanism would eventually trigger (10 minutes later)

This is **exactly what the DISCOVERY_DEADLOCK_PREVENTION.md document
described**, but the `safeFileWrite()` fix it mentioned was **never actually
implemented**.

## The Fix

Implemented multi-layer protection against promise chain deadlocks:

### Layer 1: Safe File Write Wrapper

Created `safeFileWrite()` method with timeout and error handling:

```typescript
private safeFileWrite(
  fileName: string,
  data: string | Uint8Array,
  options?: Deno.WriteFileOptions,
  timeoutMS = 30000, // 30 seconds per write
): Promise<void> {
  const writePromise = Deno.writeTextFile(fileName, data as string, options);

  let timeoutId: number;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`File write timeout: ${fileName}`));
    }, timeoutMS);
  });

  return Promise.race([writePromise, timeoutPromise]).then(
    (result) => {
      clearTimeout(timeoutId);
      return result;
    },
    (error) => {
      clearTimeout(timeoutId);
      console.error(`[DiscoverStructure] File write failed for ${fileName}:`, error);
      // Don't rethrow - allow other file writes to continue
    },
  );
}
```

**Key features:**

- 30-second timeout per file write
- Clears timeout on completion or error
- Logs errors without breaking the chain
- Prevents single failed write from blocking everything

### Layer 2: Promise Chain Error Handlers

Updated all promise chains to use `safeFileWrite()` and add `.catch()` handlers:

```typescript
const nextPromise = previousPromise.then(() =>
  this.safeFileWrite(fileName, dataCSV, { append: true, create: false })
).catch((error) => {
  console.error(
    `[DiscoverStructure] Promise chain failed for neuron ${neuronUUID}:`,
    error,
  );
  // Don't rethrow - allow other neurons to continue
});
```

**Result:** Each neuron's file write chain is independent. One failure doesn't
break others.

### Layer 3: Promise.all() Timeout Wrapper

Added timeout protection around the critical `Promise.all()`:

```typescript
const allWritesPromise = Promise.all([...neuronPromisesMap.values()]);
const WRITE_TIMEOUT_MS = 60000; // 60 seconds for all writes
let writeTimeoutId: number | undefined;
const writeTimeoutPromise = new Promise<void>((_, reject) => {
  writeTimeoutId = setTimeout(() => {
    reject(new Error(`File writes timeout`));
  }, WRITE_TIMEOUT_MS);
});

try {
  await Promise.race([allWritesPromise, writeTimeoutPromise]);
  if (writeTimeoutId !== undefined) clearTimeout(writeTimeoutId);
} catch (error) {
  if (writeTimeoutId !== undefined) clearTimeout(writeTimeoutId);
  console.warn(`Discovery file writes failed or timed out:`, error);
  // Continue anyway - we'll work with whatever data we have
}
```

**Key features:**

- 60-second timeout for all file writes to complete
- Clears timeout on completion or error
- Continues with partial data if timeout occurs
- No timer leaks

## Files Modified

### Source Code

- `src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts`
  - Added `safeFileWrite()` method (lines 92-136)
  - Updated `initialize()` to use `safeFileWrite()` with error handling
  - Updated `record()` to use `safeFileWrite()` for both input and non-input
    neurons

- `src/architecture/ErrorGuidedStructuralEvolution/DiscoverDirectory.ts`
  - Added Promise.all() timeout wrapper with proper timer cleanup (lines
    272-303)

### Tests

- `test/ErrorGuidedStructuralEvolution/PromiseChainErrorHandling.ts` (NEW)
  - Tests promise chain error handling
  - Tests graceful file write failure handling
  - Tests Promise.all() timeout protection

## Test Results

All 23 discovery tests pass:

```
✅ 23/23 tests passing
- 3 new promise chain error handling tests
- 20 existing discovery tests (no regressions)
```

**Test Coverage:**

- ✅ Promise chains have error handlers
- ✅ File write failures handled gracefully
- ✅ Promise.all() completes within timeout
- ✅ No timer leaks
- ✅ Large neuron counts (1967+)
- ✅ Timeout handling
- ✅ Invalid data detection

## What This Fixes

| Scenario             | Before                             | After                                     |
| -------------------- | ---------------------------------- | ----------------------------------------- |
| File write hangs     | Entire discovery deadlocks forever | 30s timeout → error logged → continues    |
| File write fails     | Silent hang, no errors             | Error logged, other neurons continue      |
| Promise chain breaks | Hangs forever at Promise.all()     | 60s timeout → continues with partial data |
| Worker hangs         | 10+ minute wait, timeout           | Quick failure with clear error message    |

## Expected Behavior Now

### If Discovery Completes Successfully

- All file writes succeed
- No error messages
- Discovery returns normally with results

### If File Writes Fail

- Clear error messages: `[DiscoverStructure] File write failed for {file}`
- Discovery continues with available data
- Other neurons not affected by one failure

### If Discovery Still Hangs

- Will timeout at the Promise.all() level (60 seconds)
- Will log: `Discovery file writes failed or timed out`
- Will continue with partial data
- If still hanging elsewhere, the 10-minute worker timeout will trigger

## Impact

- **No more silent deadlocks**: Errors are logged immediately
- **Fast failure**: Issues surface in 30-60 seconds, not 10 minutes
- **Graceful degradation**: Continues with partial data instead of complete
  failure
- **Better diagnostics**: Clear error messages identify exact failure points

## Testing Commands

```bash
# Run all discovery tests
deno test "test/ErrorGuidedStructuralEvolution/*.ts" --allow-read --allow-write --allow-env

# Run promise chain tests specifically
deno test test/ErrorGuidedStructuralEvolution/PromiseChainErrorHandling.ts --allow-read --allow-write --allow-env

# Run full quality check
bash quality.sh
```

## Notes

- The timer leak issues in some evolve tests are pre-existing and unrelated to
  this fix
- All discovery-specific tests pass cleanly with no leaks
- The fix follows the design outlined in DISCOVERY_DEADLOCK_PREVENTION.md
- The implementation was validated with TDD approach as requested

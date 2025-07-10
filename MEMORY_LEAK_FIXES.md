# Memory Leak Fixes for NEAT-AI Multithreading

## Critical Issue: Out of Memory Errors

The application is experiencing **fatal out-of-memory errors** after ~17-18
generations, with memory usage growing from 235MB to 296MB rapidly. The garbage
collector is failing to reclaim memory effectively.

**Note**: Forced garbage collection is disabled due to a Deno version
compatibility issue. This fix focuses on aggressive object clearing instead.

## Applied Fixes

### 1. **Aggressive JSON String Cleanup**

- **Problem**: Large JSON objects created for worker communication stay in
  memory
- **Fix**: Immediately clear large object properties after JSON.stringify()
- **Files**: `src/multithreading/workers/WorkerHandler.ts`

```typescript
// After creating JSON string, immediately clear large properties
const json = creature.exportJSON();
const jsonString = JSON.stringify(json);
// Clear large properties to help GC
json.neurons = null;
json.synapses = null;
```

### 2. **Worker-Level Memory Cleanup**

- **Problem**: Large result objects accumulate in worker memory
- **Fix**: Clear large objects immediately after processing
- **Files**: `src/multithreading/workers/WorkerProcessor.ts`

```typescript
// Clear large objects immediately after use
if (result.trace) {
  result.trace = null;
}
if (result.compact) {
  result.compact = null;
}
// Force cleanup of creature objects
creature.neurons = null;
creature.synapses = null;
```

<<<<<<< HEAD

### 3. **Evolution Loop Memory Management**

- **Problem**: Memory accumulates over generations without cleanup
- **Fix**: Periodic memory monitoring and forced garbage collection =======

### 3. **Evolution Loop Memory Monitoring**

- **Problem**: Memory accumulates over generations without monitoring
- **Fix**: Periodic memory monitoring without forced garbage collection

>>>>>>> 8f95386 (Update version to 0.179.12 and enhance memory management
>>>>>>> strategies)

- **Files**: `src/Creature.ts`

```typescript
// Periodic memory monitoring every 30 seconds
const currentTime = Date.now();
if (currentTime - lastMemoryCheck > MEMORY_CHECK_INTERVAL) {
  const memUsage = Deno.memoryUsage();
  console.log(
    `Memory usage (Generation ${generation}): ${
      Math.round(memUsage.heapUsed / 1024 / 1024)
    }MB used`,
  );

  // Force garbage collection if available
  if (typeof (globalThis as any).gc === "function") {
    (globalThis as any).gc();
  }
}
```

### 4. **Training Completion Cleanup**

- **Problem**: Large training result objects accumulate in arrays
- **Fix**: Immediately clear large objects after processing
- **Files**: `src/NEAT/Neat.ts`

```typescript
// Immediately clear large objects to help GC
r.train.creature = null;
r.train.trace = null;
r.train.compact = null;
r.train.backtracked = null;
r.train.forward = null;
```

### 5. **Improved Worker Termination**

- **Problem**: Event listeners and callbacks not properly cleaned up
- **Fix**: Clear all callbacks and listeners in terminate() method
- **Files**: `src/multithreading/workers/WorkerHandler.ts`,
  `src/multithreading/workers/MockWorker.ts`

## Runtime Configuration

### Enable Garbage Collection

Run with garbage collection enabled:

```bash
deno run --v8-flags=--expose-gc --allow-read --allow-write --allow-net your-script.ts
```

### Increase Memory Limit

If still needed, increase the memory limit:

>>>>>>> strategies)

```bash
deno run --v8-flags=--max-old-space-size=32768 --allow-read --allow-write --allow-net your-script.ts
```

## Monitoring Memory Usage

Add this to your main script to monitor memory:

```typescript
// Monitor memory every 10 generations
if (generation % 10 === 0) {
  const memUsage = Deno.memoryUsage();
  console.log(
    `Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB used, ${
      Math.round(memUsage.heapTotal / 1024 / 1024)
    }MB total`,
  );
}
```

## Expected Results

After applying these fixes, you should see:

- **Stable memory usage** over long runs (100+ generations)
- **No out-of-memory errors**
- **Reduced memory growth rate**
- **More predictable memory footprint**

## Testing Strategy

1. **Run Long Evolution**: Test with 50+ generations
2. **Monitor Memory**: Watch for memory stabilization
3. **Check Memory Growth**: Look for reduced memory growth rate
4. **Stress Test**: Run with multiple workers and large datasets

## Additional Recommendations

### 1. **Worker Pool Recycling**

Consider implementing a worker pool that recycles workers every N generations to
prevent memory accumulation.

### 2. **Memory Profiling**

Use Deno's built-in memory profiling:

```bash
deno run --inspect-brk --allow-all your-script.ts
```

### 3. **Dataset Optimization**

Consider using smaller batch sizes or streaming data to reduce memory pressure.

### 4. **Creature Simplification**

Implement more aggressive creature simplification to reduce JSON size.

### 5. **Deno Version**

Consider downgrading Deno if the GC issue persists, or wait for the Deno team to
fix the GC compatibility issue.

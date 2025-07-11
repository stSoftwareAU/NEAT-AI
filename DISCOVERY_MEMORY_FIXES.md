# Discovery Memory Leak Fixes

## Issues Identified in Discovery Files

The discovery process involves processing large amounts of data and creating many temporary arrays and buffers that can accumulate in memory. Here are the key memory leaks found and fixed:

## Applied Fixes

### 1. **DiscoverDirectory.ts - Buffer Cleanup**
- **Problem**: Large `batchBuffer` and `batchArray` objects not cleared after file processing
- **Fix**: Clear buffers with `fill(0)` after processing each file
- **Impact**: Reduces memory accumulation during file processing

```typescript
// Clear large buffers to help GC
batchBuffer.fill(0);
batchArray.fill(0);
```

### 2. **DiscoverDirectory.ts - Array Cleanup**
- **Problem**: `dataSet` array and `neuronPromisesMap` not cleared after processing
- **Fix**: Clear arrays and maps after processing
- **Impact**: Prevents accumulation of large data arrays

```typescript
// Clear large arrays to help GC
dataSet.length = 0;
neuronPromisesMap.clear();
```

### 3. **DiscoverStructure.ts - CSV Buffer Cleanup**
- **Problem**: Large file read buffers not cleared after CSV processing
- **Fix**: Clear buffer with `fill(0)` after file processing
- **Impact**: Reduces memory usage during CSV file reading

```typescript
// Clear large buffers to help GC
buffer.fill(0);
```

### 4. **DiscoverStructure.ts - Analysis Array Cleanup**
- **Problem**: Large arrays in `findCandidateSquash` method not cleared
- **Fix**: Clear arrays after processing
- **Impact**: Prevents accumulation of activation arrays

```typescript
// Clear large arrays to help GC
rawValues.length = 0;
currentActivations.length = 0;
idealActivations.length = 0;
```

### 5. **DiscoverStructure.ts - Candidate Analysis Cleanup**
- **Problem**: Large arrays in `analyzeCandidateSynapse` not cleared
- **Fix**: Clear record arrays after processing
- **Impact**: Reduces memory usage during synapse analysis

```typescript
// Clear large arrays to help GC
toRecords.length = 0;
fromRecords.length = 0;
```

### 6. **DiscoverStructure.ts - Neuron Analysis Cleanup**
- **Problem**: Large arrays in `analyzeSelectedNeurons` not cleared
- **Fix**: Clear candidate arrays after processing
- **Impact**: Prevents accumulation of candidate arrays

```typescript
// Clear large arrays to help GC
candidateArrays.length = 0;
```

### 7. **DiscoverStructure.ts - Neuron Listing Cleanup**
- **Problem**: Record arrays in `listViableNeurons` not cleared
- **Fix**: Clear records array after processing each neuron
- **Impact**: Reduces memory usage during neuron analysis

```typescript
// Clear records array to help GC
records.length = 0;
```

## Memory Usage Patterns

### Before Fixes:
- **Large buffers** accumulated during file processing
- **Data arrays** grew during discovery analysis
- **CSV records** accumulated in memory
- **Candidate arrays** not cleared after processing

### After Fixes:
- **Immediate cleanup** of large objects after use
- **Reduced memory footprint** during discovery
- **Better garbage collection** opportunities
- **More stable memory usage** over long runs

## Expected Results

After applying these fixes, you should see:
- **Reduced memory usage** during discovery operations
- **Faster garbage collection** due to smaller object graphs
- **More stable memory footprint** during long discovery runs
- **Reduced risk of out-of-memory errors** during discovery

## Testing Strategy

1. **Run Discovery**: Test with large datasets to see memory stabilization
2. **Monitor Memory**: Watch for reduced memory growth during discovery
3. **Long Runs**: Test discovery over extended periods
4. **Multiple Workers**: Test with concurrent discovery operations

## Additional Recommendations

### 1. **Streaming Processing**
Consider implementing streaming CSV processing to avoid loading entire files into memory.

### 2. **Batch Size Optimization**
Adjust `discoveryBatchSize` based on available memory to balance performance and memory usage.

### 3. **Memory Monitoring**
Add memory usage logging during discovery to track improvements:

```typescript
if (options.log) {
  const memUsage = Deno.memoryUsage();
  console.log(`Discovery memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
}
```

### 4. **Worker Recycling**
Consider recycling discovery workers periodically to prevent memory accumulation in long-running processes. 
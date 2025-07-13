# Discovery Memory Leak Fixes

## Issues Identified in Discovery Files

The discovery process involves processing large amounts of data and creating
many temporary arrays and buffers that can accumulate in memory. Here are the
key memory leaks found and fixed:

## Applied Fixes

### 1. **DiscoverDirectory.ts - Buffer Cleanup**

- **Problem**: Large `batchBuffer` and `batchArray` objects not cleared after
  file processing
- **Fix**: Clear buffers with `length = 0` after processing each file
- **Impact**: Reduces memory accumulation during file processing

```typescript
// Clear large buffers to help GC
batchBuffer.length = 0;
batchArray.length = 0;
```

### 2. **DiscoverDirectory.ts - Array Cleanup**

- **Problem**: `dataSet` array and `neuronPromisesMap` not cleared after
  processing
- **Fix**: Clear arrays and maps after processing
- **Impact**: Prevents accumulation of large data arrays

```typescript
// Clear large arrays to help GC
dataSet.length = 0;
neuronPromisesMap.clear();
```

### 3. **DiscoverDirectory.ts - Index Arrays Cleanup**

- **Problem**: `tmpIndexes` array and `recordSet` not cleared after file processing
- **Fix**: Clear arrays and sets after processing each file
- **Impact**: Reduces memory usage during file processing

```typescript
// Clear large arrays to help GC
tmpIndexes.length = 0;
recordSet.clear();
```

### 4. **DiscoverStructure.ts - CSV Buffer Cleanup**

- **Problem**: Large file read buffers not cleared after CSV processing
- **Fix**: Clear buffer with `length = 0` after file processing
- **Impact**: Reduces memory usage during CSV file reading

```typescript
// Clear large buffers to help GC
buffer.length = 0;
```

### 5. **DiscoverStructure.ts - TextDecoder Optimization**

- **Problem**: New `TextDecoder` created for each file load
- **Fix**: Reusable `TextDecoder` as class property
- **Impact**: Reduces object creation overhead

```typescript
private textDecoder: TextDecoder;

constructor(creature: Creature) {
  // ...
  this.textDecoder = new TextDecoder();
}
```

### 6. **DiscoverStructure.ts - Buffer Size Optimization**

- **Problem**: Large 256KB buffer size for CSV processing
- **Fix**: Reduced to 10KB buffer size (25x reduction)
- **Impact**: Significantly reduces memory footprint during file processing

```typescript
// Process the file in chunks to avoid memory issues
const bufferSize = 10 * 1024; // Was 256k
```

### 7. **DiscoverStructure.ts - Analysis Array Cleanup**

- **Problem**: Large arrays in `findCandidateSquash` method not cleared
- **Fix**: Clear arrays after processing
- **Impact**: Prevents accumulation of activation arrays

```typescript
// Clear large arrays to help GC
rawValues.length = 0;
currentActivations.length = 0;
idealActivations.length = 0;
```

### 8. **DiscoverStructure.ts - Candidate Analysis Cleanup**

- **Problem**: Large arrays in `analyzeCandidateSynapse` not cleared
- **Fix**: Clear record arrays after processing
- **Impact**: Reduces memory usage during synapse analysis

```typescript
// Clear fromRecords array to help GC
fromRecords.length = 0;
```

### 9. **DiscoverStructure.ts - Neuron Analysis Cleanup**

- **Problem**: Large arrays in `analyzeSelectedNeurons` not cleared
- **Fix**: Clear candidate arrays after processing
- **Impact**: Prevents accumulation of candidate arrays

```typescript
// Clear large arrays to help GC
candidateArrays.length = 0;
```

### 10. **DiscoverStructure.ts - Neuron Listing Cleanup**

- **Problem**: Record arrays in `listViableNeurons` not cleared
- **Fix**: Clear records array after processing each neuron
- **Impact**: Reduces memory usage during neuron analysis

```typescript
// Clear records array to help GC
records.length = 0;
```

### 11. **DiscoverStructure.ts - Data Map Cleanup**

- **Problem**: Data map and its arrays not cleared after recording
- **Fix**: Clear data map and its arrays after processing
- **Impact**: Reduces memory usage during data recording

```typescript
// Clear data map and its arrays to help GC
for (const records of data.values()) {
  records.length = 0;
}
data.clear();
```

### 12. **DiscoverStructure.ts - CSV Processing Optimization**

- **Problem**: Inefficient CSV line processing
- **Fix**: Early trimming check and optimized line processing
- **Impact**: More efficient CSV parsing

```typescript
// Clear lines array to help GC
lines.length = 0;
```

### 13. **DiscoverStructure.ts - Synapse Removal Analysis Cleanup**

- **Problem**: Large arrays in `analyzeSelectedNeuronsForRemoval` not cleared
- **Fix**: Clear promises and candidate arrays after processing
- **Impact**: Reduces memory usage during synapse removal analysis

```typescript
// Clear large arrays to help GC
promises.length = 0;
candidates.length = 0;
allCandidates.length = 0;
```

## Memory Usage Patterns

### Before Fixes:

- **Large buffers** accumulated during file processing
- **Data arrays** grew during discovery analysis
- **CSV records** accumulated in memory
- **Candidate arrays** not cleared after processing
- **TextDecoder instances** created for each file
- **256KB buffers** used for CSV processing

### After Fixes:

- **Immediate cleanup** of large objects after use
- **Reduced memory footprint** during discovery
- **Better garbage collection** opportunities
- **More stable memory usage** over long runs
- **Reusable TextDecoder** reduces object creation
- **10KB buffers** reduce memory pressure

## Expected Results

After applying these fixes, you should see:

- **Reduced memory usage** during discovery operations
- **Faster garbage collection** due to smaller object graphs
- **More stable memory footprint** during long discovery runs
- **Reduced risk of out-of-memory errors** during discovery
- **Better performance** due to optimized buffer sizes and object reuse

## Testing Strategy

1. **Run Discovery**: Test with large datasets to see memory stabilization
2. **Monitor Memory**: Watch for reduced memory growth during discovery
3. **Long Runs**: Test discovery over extended periods
4. **Multiple Workers**: Test with concurrent discovery operations

## Additional Recommendations

### 1. **Streaming Processing**

Consider implementing streaming CSV processing to avoid loading entire files
into memory.

### 2. **Batch Size Optimization**

Adjust `discoveryBatchSize` based on available memory to balance performance and
memory usage.

### 3. **Memory Monitoring**

Add memory usage logging during discovery to track improvements:

```typescript
if (options.log) {
  const memUsage = Deno.memoryUsage();
  console.log(
    `Discovery memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
  );
}
```

### 4. **Worker Recycling**

Consider recycling discovery workers periodically to prevent memory accumulation
in long-running processes.

## Performance Improvements Summary

- **Buffer size reduction**: 256KB → 10KB (25x reduction)
- **Memory clearing strategy**: `fill(0)` → `length = 0` (more efficient)
- **Object reuse**: TextDecoder instance reuse
- **Aggressive cleanup**: Arrays cleared immediately after use
- **Optimized processing**: Better CSV parsing and data handling

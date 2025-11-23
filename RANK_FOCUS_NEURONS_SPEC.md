# rankFocusNeurons Algorithm Specification

**Date:** 23-Nov-2025

## Purpose

`rankFocusNeurons` identifies which neurons have the highest potential for error reduction based on their error magnitude and influence on outputs. It should be a **fast calculation** (< 1 second for typical networks).

## Current Problem

Taking **173 seconds** for 463 neurons with 41,000 records. Expected time: **< 1 second**.

## Algorithm

### Input
- `parquetFile`: Path to Parquet file containing ~41,000 records
- `creature`: Network topology (neurons and synapses)
- `maxResults`: Number of top neurons to return (e.g., 64)

### Output
For each non-input neuron:
- `neuronUuid`: The neuron identifier
- `totalError`: Average absolute error across all records
- `impact`: Share of creature-level error this neuron can influence (0.0 to 1.0)

Sorted by `totalError × impact` (descending).

## Step-by-Step Calculation

### Step 1: Read Parquet File **ONCE**
```
Read ALL records from parquetFile into memory
- Records: 41,000 samples
- Each record has neuron_data array with errors for each non-input neuron
```
**Complexity:** O(records) = 41,000 operations  
**Time:** ~10-50ms

### Step 2: Calculate totalError for Each Neuron
```
For each non-input neuron:
  totalError = 0
  count = 0
  
  For each record in parquet:
    For each error in record.neuron_data[neuron].errors:
      totalError += abs(error)
      count++
  
  totalError = totalError / count
```
**Complexity:** O(neurons × records × errors_per_neuron)  
= 463 × 41,000 × ~1 = ~19M simple operations  
**Time:** ~100-200ms

**Optimization:** Use vectorized operations (Polars/Arrow) instead of loops.

### Step 3: Calculate Impact (Share) for Each Neuron **ONCE**

This is a **single backward pass** through the network topology:

```
1. Build topology maps (once):
   - inbound_connections: Map<neuronIndex, List<{fromIndex, weight}>>
   - neuron_shares: Map<neuronIndex, 0.0>

2. Initialize outputs:
   baseShare = 1.0 / num_outputs
   For each output neuron:
     neuron_shares[output] = baseShare

3. Backward propagation (single pass):
   visited = Set()
   
   def propagate_share(neuronIndex, share, path):
     if share <= 0 or neuronIndex in path:
       return  # Prevent cycles
     
     neuron_shares[neuronIndex] += share
     path.add(neuronIndex)
     
     inbound = inbound_connections[neuronIndex]
     if inbound.isEmpty():
       path.remove(neuronIndex)
       return
     
     total_abs_weight = sum(abs(conn.weight) for conn in inbound)
     
     for conn in inbound:
       if total_abs_weight > EPSILON:
         fraction = abs(conn.weight) / total_abs_weight
       else:
         fraction = 1.0 / len(inbound)  # Equal split if all weights ~0
       
       propagate_share(conn.fromIndex, share * fraction, path)
     
     path.remove(neuronIndex)
   
   For each output neuron:
     propagate_share(output, baseShare, Set())

4. Cap shares at 1.0:
   For each neuron:
     neuron_shares[neuron] = min(1.0, neuron_shares[neuron])
```

**Complexity:** O(neurons + connections) = single graph traversal  
= 463 neurons + ~few thousand connections = ~5,000 operations  
**Time:** ~1-5ms

### Step 4: Combine and Sort
```
For each non-input neuron:
  score = totalError × impact
  
Sort neurons by score (descending)
Return top maxResults neurons
```
**Complexity:** O(neurons × log neurons) = 463 × log(463) ≈ 4,000  
**Time:** < 1ms

## Total Expected Performance

| Step | Complexity | Expected Time |
|------|-----------|---------------|
| 1. Read Parquet | O(records) | 10-50ms |
| 2. Calculate totalError | O(neurons × records) | 100-200ms |
| 3. Calculate impact | O(neurons + connections) | 1-5ms |
| 4. Sort | O(neurons × log neurons) | < 1ms |
| **TOTAL** | | **< 300ms** |

**Current:** 173 seconds = **578x slower than expected!**

## Common Performance Pitfalls

### ❌ DON'T: Read Parquet Multiple Times
```rust
// BAD: Reading file for each neuron
for neuron in neurons {
  let records = read_parquet(path)?;  // 463 file reads!
  let error = calculate_error(neuron, records);
}
```

### ✅ DO: Read Once, Process All
```rust
// GOOD: Single file read
let records = read_parquet(path)?;
for neuron in neurons {
  let error = calculate_error(neuron, &records);
}
```

### ❌ DON'T: Recalculate Impact for Each Neuron
```rust
// BAD: 463 graph traversals
for neuron in neurons {
  let impact = calculate_impact_for_neuron(neuron, &topology);  // Full traversal each time!
}
```

### ✅ DO: Single Backward Pass
```rust
// GOOD: One traversal for all neurons
let all_impacts = calculate_all_impacts_once(&topology);
for neuron in neurons {
  let impact = all_impacts.get(neuron);
}
```

### ❌ DON'T: Allocate Inside Loops
```rust
// BAD: Creating new vectors in hot loop
for record in records {
  for neuron in neurons {
    let errors = Vec::new();  // 463 × 41,000 allocations!
    // ...
  }
}
```

### ✅ DO: Reuse Allocations
```rust
// GOOD: Allocate once, reuse
let mut error_accumulator = vec![0.0; num_neurons];
let mut count_accumulator = vec![0; num_neurons];
for record in records {
  for (idx, neuron_data) in record.neuron_data.iter().enumerate() {
    error_accumulator[idx] += neuron_data.error.abs();
    count_accumulator[idx] += 1;
  }
}
```

## Debugging Checklist

If `rankFocusNeurons` is slow, check:

1. ✅ Is Parquet read only once at the start?
2. ✅ Are we using vectorized operations (Polars) for aggregations?
3. ✅ Is impact calculated via single backward pass, not per-neuron?
4. ✅ Are topology maps built once, not per neuron?
5. ✅ Are allocations outside hot loops?
6. ✅ Is logging disabled or outside tight loops?
7. ✅ Are we using `release` build, not `debug`?

## Reference Implementation

See TypeScript version:
- `CreatureErrorImpactEstimator.getNeuronShare()` - calculates impact via backward propagation
- File: `src/discovery/NeuronErrorImpactEstimator.ts:62-121`

The TypeScript version calculates impact for **all neurons in a single pass** using backward propagation from outputs.


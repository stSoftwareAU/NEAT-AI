# Diagnostic Logging for Excessive record() Calls

## Date: 15-Nov-2024

## Problem

Discovery is timing out (5+ minutes for 20 samples) and showing 1,020,488 errors
for a single neuron when it should have ~20 errors. This suggests `record()` is
being called **17,000x more than it should**, which would absolutely explain the
performance issue.

## Diagnostic Logging Added

### 1. Per-Neuron Logging (`Neuron.ts`)

**Location**: `Neuron.record()` method

**Triggers**:

- **Warning** at 50 errors: Logs which neuron and how many times it's been
  called
- **Error & Crash** at 100 errors: Prevents runaway recursion

**Output Example**:

```
⚠️  PERFORMANCE: Neuron hidden-X record() called 51 times in single sample!
  Type: hidden, Inward connections: 5, Current errors: 50

❌ CRITICAL: Neuron hidden-X has 100 errors - likely infinite recursion!
Error: Excessive record() calls detected on neuron hidden-X. 
Expected 1-3 calls per sample, got 101. This explains the performance issue and timeout.
```

### 2. Per-Sample Total Logging (`Creature.ts`)

**Location**: `Creature.record()` method (after all output neurons finish)

**Triggers**:

- **Warning** if total errors > `neurons.length × outputs × 3`
- **Error & Crash** if total errors > `neurons.length × outputs × 30`

**Output Example**:

```
❌ CRITICAL: Sample generated 25000 total errors (expected ≤1347)
   Neurons: 449, Outputs: 1, ErrorMap size: 449
   Top 5 neurons by error count:
     - hidden-42: 5000 errors
     - hidden-17: 4800 errors
     - hidden-93: 4200 errors
     - hidden-5: 3900 errors
     - hidden-128: 3500 errors

Error: Excessive errors detected: 25000 total errors in single sample (expected ≤1347). 
This indicates record() is being called too many times, causing the performance issue and timeout.
```

### 3. Sample Context Logging (`DiscoverStructure.ts`)

**Location**: `DiscoverStructure.record()` loop

**Triggers**: When any error is thrown that includes "Excessive record()"

**Output Example**:

```
❌ Error occurred while processing sample 3/20
   Total samples accumulated so far: 2
   Input: [0.5, -0.3, 0.8, 0.1, -0.7]...
   Output: [0.42]...
```

## Expected Behavior

### Normal Case (20 samples, 449 neurons, 1 output):

- Each neuron should have ~20 errors (one per sample)
- Total errors per sample: ~449 (one per neuron)
- **No warnings or errors**

### Problem Case (your data):

- One neuron has 1,020,488 errors
- This logging will catch it at:
  - **51 errors**: First warning (shows which neuron and sample)
  - **101 errors**: Crash (prevents wasting 5 minutes)

## What to Look For

When you run the failing discovery, you'll see:

1. **Which sample** triggers the problem (1st? 2nd? All of them?)
2. **Which neuron(s)** accumulate excessive errors
3. **How many inward connections** that neuron has
4. **Top 5 neurons** by error count

This will tell you:

- Is it one problematic neuron or all neurons?
- Is it happening on the first sample or accumulating over time?
- Is it related to network topology (neurons with many connections)?

## Root Cause Hypotheses

Based on the logging output, you can determine:

### Hypothesis 1: Infinite Recursion

- Same neuron keeps calling itself
- **Look for**: Circular connections in the network
- **Log shows**: Single neuron with 100+ errors, crash happens quickly

### Hypothesis 2: Not Clearing Between Samples

- Errors accumulate across samples instead of being cleared
- **Look for**: Error map reused between samples
- **Log shows**: Errors increase with each sample number

### Hypothesis 3: Multiple Paths Trigger Multiple Calls

- Complex network topology causes same neuron to be visited many times
- **Look for**: Neurons with many incoming/outgoing connections
- **Log shows**: All neurons have excessive errors, proportional to connectivity

### Hypothesis 4: Output Neurons Called Multiple Times

- `Creature.record()` calls output neurons multiple times
- **Look for**: Loop bug in `Creature.record()`
- **Log shows**: Output neurons have most errors

## Performance Impact

If a neuron is called 100x per sample instead of 1x:

- **100x slower** per sample
- 20 samples × 449 neurons × 100 calls = **898,000 operations** instead of 8,980
- Explains why 20 samples take 5+ minutes instead of <1 second

## Testing

All existing tests pass. The diagnostic logging only triggers when there's a
problem, so it doesn't affect normal operation.

Run your failing discovery - it will crash quickly (at ~100 errors) with full
diagnostic info instead of timing out after 5 minutes!

# Discovery Timeout Strategy: Vertical vs Horizontal

**Date:** 23-Nov-2025

## The Problem

Current timeout strategy is **horizontal** - tries to analyze all focus neurons
but may timeout before completing upstream analysis for any of them.

## Current (Horizontal) Timeout ❌

```
Focus Neurons: [A, B, C, D, E, F]

Timeline:
0s   ─────────────────────────────────────> 60s (TIMEOUT)
     ↓                                       ↓
A:   [scan errors].......................[TIMEOUT - no upstream analysis]
B:   [scan errors].......................[TIMEOUT - no upstream analysis]  
C:   [scan errors].......................[TIMEOUT - no upstream analysis]
D:   [scan errors].......................[TIMEOUT - no upstream analysis]
E:   [scan errors].......................[TIMEOUT - no upstream analysis]
F:   [scan errors].......................[TIMEOUT - no upstream analysis]

Result: 0 useful candidates because no upstream analysis completed
```

**Message:** "Target insider-volume-check-14 had no upstream neurons to
analyse."

## Proposed (Vertical) Timeout ✅

```
Focus Neurons: [A, B, C, D, E, F]

Timeline:
0s   ─────────────────────────────────────> 60s (TIMEOUT)
     ↓                     ↓                 ↓
A:   [scan][upstream]──✓─┐                  │
B:   [scan][upstream]──✓─┤ Complete!        │
C:   [scan][upstream]──✓─┘                  │
D:   [scan][upstream──────────────────✓]────┤ Complete!
E:   [scan][upstream──────────────────────] │ TIMEOUT (partial)
F:   [not started]                          │ TIMEOUT (skipped)

Result: 4 complete analyses with full upstream candidates
```

**Benefit:** Get useful candidates for neurons A, B, C, D even if E and F
timeout.

## Implementation Strategy

### Option 1: Per-Neuron Timeout Budget

```rust
fn analyze_all(focus_neurons: Vec<String>, total_deadline: Instant) {
    let mut results = Vec::new();
    
    for focus_neuron in focus_neurons {
        let remaining_time = total_deadline - Instant::now();
        if remaining_time.is_zero() {
            log::warn!("⏱️  Analysis deadline reached. Analyzed {}/{} focus neurons.", 
                       results.len(), focus_neurons.len());
            break;  // Return partial results
        }
        
        // Analyze THIS neuron completely (scan errors + find upstream)
        match analyze_neuron_complete(focus_neuron, remaining_time) {
            Ok(candidates) => {
                results.extend(candidates);
                log::debug!("✓ Completed analysis for {}", focus_neuron);
            }
            Err(Timeout) => {
                log::warn!("⏱️  Timeout during analysis of {}. Returning results for {}/{} neurons.",
                           focus_neuron, results.len(), focus_neurons.len());
                break;
            }
        }
    }
    
    return results;
}
```

### Option 2: Adaptive Timeout Per Neuron

```rust
fn analyze_all(focus_neurons: Vec<String>, total_deadline: Instant) {
    let total_time_budget = total_deadline - Instant::now();
    let time_per_neuron = total_time_budget / focus_neurons.len();
    
    for (idx, focus_neuron) in focus_neurons.iter().enumerate() {
        let neuron_deadline = Instant::now() + time_per_neuron;
        
        match analyze_neuron_with_deadline(focus_neuron, neuron_deadline) {
            Ok(candidates) => {
                results.extend(candidates);
            }
            Err(Timeout) => {
                // This neuron took too long, skip to next
                log::warn!("⏱️  Neuron {} exceeded time budget, skipping", focus_neuron);
                continue;
            }
        }
        
        // Check global deadline
        if Instant::now() >= total_deadline {
            log::warn!("⏱️  Global deadline reached after {}/{} neurons", 
                       idx + 1, focus_neurons.len());
            break;
        }
    }
}
```

### Option 3: Priority Queue (Best First)

```rust
// Analyze neurons in order of highest potential error reduction
fn analyze_all(focus_neurons: Vec<String>, total_deadline: Instant) {
    // Sort by totalError × impact (descending)
    let sorted_neurons = sort_by_potential_impact(focus_neurons);
    
    for neuron in sorted_neurons {
        if Instant::now() >= total_deadline {
            break;
        }
        
        // Fully analyze the highest-priority neurons first
        analyze_neuron_complete(neuron, total_deadline)?;
    }
}
```

**Benefit:** Most impactful neurons get analyzed first, maximizing value even
with timeout.

## Current Code Structure

The problem is in how `analyzeAll` / `analyze_parallel` handles the deadline:

```rust
// CURRENT (BAD): Horizontal timeout
fn analyze_neurons(focus_list: Vec<String>, deadline_ms: u64) {
    let deadline = Instant::now() + Duration::from_millis(deadline_ms);
    
    for neuron in focus_list {
        // Check deadline at TOP of loop
        if Instant::now() >= deadline {
            log::warn!("analyse_neurons reached analysis deadline");
            break;  // ← This leaves current neuron incomplete!
        }
        
        // Start analyzing neuron...
        scan_errors_for_neuron(neuron)?;
        // But timeout before finding upstream neurons!
    }
}
```

**Problem:** Deadline check happens BEFORE completing analysis for current
neuron.

```rust
// BETTER (GOOD): Vertical timeout
fn analyze_neurons(focus_list: Vec<String>, deadline_ms: u64) {
    let deadline = Instant::now() + Duration::from_millis(deadline_ms);
    let mut completed = Vec::new();
    
    for neuron in focus_list {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            log::warn!("Deadline reached. Completed {}/{} neurons", 
                       completed.len(), focus_list.len());
            break;
        }
        
        // Analyze THIS neuron COMPLETELY (with timeout guard inside)
        match analyze_neuron_complete(neuron, deadline) {
            Ok(result) => {
                completed.push(result);
                log::debug!("✓ Completed {}", neuron);
            }
            Err(Timeout) => {
                log::warn!("Timeout during {}. Skipping to preserve completed analyses.", neuron);
                break;  // ← Return what we have so far
            }
        }
    }
    
    return completed;
}

fn analyze_neuron_complete(neuron: String, deadline: Instant) -> Result<Analysis, Error> {
    // Step 1: Scan errors (fast)
    let errors = scan_errors(neuron)?;
    
    // Step 2: Find upstream neurons (the part that's failing!)
    if Instant::now() >= deadline {
        return Err(Timeout);  // Don't start if we can't finish
    }
    let upstream = find_upstream_neurons(neuron, deadline)?;
    
    // Step 3: Analyze upstream connections
    if Instant::now() >= deadline {
        return Err(Timeout);
    }
    let candidates = analyze_upstream_connections(neuron, upstream, deadline)?;
    
    Ok(Analysis { neuron, candidates })
}
```

## What This Fixes

**Before (Horizontal):**

```
[NEAT-AI-Discovery][verbose] analyse_neurons reached analysis deadline; returning partial results.
[NEAT-AI-Discovery][verbose] Target insider-volume-check-14 had no upstream neurons to analyse.
[NEAT-AI-Discovery][verbose] Target proximity-check-near-zero-SP500-inclusion-v3 had no upstream neurons to analyse.
```

Result: 0 useful candidates

**After (Vertical):**

```
[NEAT-AI-Discovery][verbose] ✓ Completed analysis for output-0 (23 candidates)
[NEAT-AI-Discovery][verbose] ✓ Completed analysis for 57882a2a-fbb1-44fd-8807-865cec35a49a (15 candidates)
[NEAT-AI-Discovery][verbose] ✓ Completed analysis for insider-volume-check-14 (18 candidates)
[NEAT-AI-Discovery][verbose] ✓ Completed analysis for proximity-check-near-zero-SP500-inclusion-v3 (12 candidates)
[NEAT-AI-Discovery][verbose] ⏱️  Timeout during analysis of next-neuron-uuid. Returning 4/6 complete analyses.
```

Result: 68 useful candidates from 4 complete analyses!

## Recommendation

Implement **Option 3 (Priority Queue)** with **vertical timeout**:

1. Sort focus neurons by `totalError × impact` (already done in TypeScript)
2. Analyze highest-priority neurons FIRST
3. Complete each neuron fully (errors + upstream) before moving to next
4. Check deadline BETWEEN neurons, not during neuron analysis
5. Return whatever completed analyses we have

This ensures we get maximum value even with timeout constraints.

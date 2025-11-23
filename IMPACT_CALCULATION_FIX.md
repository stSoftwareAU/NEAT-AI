# Impact Calculation Bug Fix - 23-Nov-2025

## Problem

Production discoveries stopped producing results because the focus neuron
selection was using incorrect impact calculations. Neurons that were many steps
away from outputs were being assigned very high impact values (e.g., 0.9816794),
causing the wrong neurons to be selected for discovery analysis.

## Root Cause

The bug was in the Rust implementation of `compute_impact_recursive` in
`/Users/nigelleck/Develop/NEAT-AI-Discovery/src/focus.rs` (line 117).

### Original (Buggy) Code

```rust
let contribution = (weight.abs() * child_impact).min(child_impact);
```

This calculated impact using the **absolute weight** without normalising by the
total incoming weight to the target neuron. For example, if a neuron connected
to `output-0` with weight `0.9816794`, it would get an impact of `0.9816794`,
even though `output-0` had 101 total incoming connections with a total absolute
weight of 342.787.

### The Problem in Detail

1. The neuron `82a5b66c-f725-4562-9c4e-bfbfb5550b0a` connects to `output-0` with
   weight `0.9816794`
2. `output-0` has 101 incoming connections totaling `342.787` in absolute weight
3. **Correct impact**: `0.9816794 / 342.787 = 0.00286` (0.286%)
4. **Buggy impact**: `0.9816794` (98.17%)

This meant neurons several layers away from outputs received artificially
inflated impact scores, causing focus selection to target the wrong neurons.

## Solution

The fix normalises each connection's contribution by the total incoming weight
to the target neuron:

```rust
// Build a map of total incoming absolute weights for each neuron
fn build_inbound_weights(creature: &CreatureJson) -> HashMap<String, f32> {
    let mut inbound_weights: HashMap<String, f32> = HashMap::new();
    for synapse in &creature.synapses {
        *inbound_weights.entry(synapse.to_uuid.clone()).or_insert(0.0) += synapse.weight.abs();
    }
    inbound_weights
}

// In compute_impact_recursive:
let total_inbound = inbound_weights.get(to_uuid).copied().unwrap_or(0.0);
let normalized_weight = if total_inbound > 1e-9 {
    weight.abs() / total_inbound
} else {
    0.0
};

let contribution = normalized_weight * child_impact;
```

## Impact

After the fix:

- `82a5b66c...` impact: `0.00286` (correctly normalized)
- `location-error-00001` impact: `0.0000037` (correctly diluted through multiple
  paths)
- `4e807e6e...` impact: `0.0000045` (correctly diluted even further)

This matches the TypeScript `CreatureErrorImpactEstimator` implementation, which
was already calculating impacts correctly.

## Testing

Added comprehensive test
`test_impact_calculation_with_multiple_incoming_connections` that verifies:

1. Impact is properly normalized when a neuron has multiple incoming connections
2. A neuron with 2x the weight has 2x the impact
3. The ratio of impacts matches the ratio of weights

All tests pass (68 unit tests + 5 integration tests).

## Files Changed

1. `/Users/nigelleck/Develop/NEAT-AI-Discovery/src/focus.rs` - Fixed impact
   calculation
2. `/Users/nigelleck/Develop/NEAT-AI-Discovery/src/lib.rs` - Added `Serialize`
   trait to `CreatureJson`, `NeuronJson`, `SynapseJson`
3. `/Users/nigelleck/Develop/NEAT-AI-Discovery/tests/integration.rs` - Added
   test case

## Next Steps

The Rust library has been rebuilt with the fix. Production discoveries should
now:

1. Calculate correct impact values that are properly normalized
2. Select the appropriate neurons for analysis based on accurate impact
   estimates
3. Resume producing discoveries successfully

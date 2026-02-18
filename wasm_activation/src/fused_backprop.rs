//! Issue #1520 - Fused backprop inner loop to eliminate TS/WASM boundary crossings.
//!
//! Combines weight accumulation for all inbound synapses of a neuron plus
//! bias accumulation into a single WASM call. This eliminates S+1 boundary
//! crossings per neuron (S `accumulateWeight` calls + 1 `accumulateBias` call)
//! and keeps all intermediate arithmetic in WASM linear memory.
//!
//! ## Input layout
//!
//! Flat f64 arrays for the N eligible synapses:
//! - `current_weights[N]` - current synapse weights
//! - `target_values[N]` - target values (`fromValue + thisLinkError`)
//! - `activations[N]` - improved from-activations (post-recursion)
//!
//! Config scalars for weight accumulation:
//! - plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale
//!
//! Bias accumulation inputs:
//! - target_pre_activation, pre_activation, current_bias
//! - max_bias_adj_scale, limit_bias_scale
//!
//! ## Output layout
//!
//! Float64Array with 7*N + 3 values:
//! - Weight deltas: [count, posAct, negAct, cntPos, cntNeg, posAdj, negAdj] × N
//! - Bias deltas: [count, totalBias, totalAdjustedBias]

use wasm_bindgen::prelude::*;

use crate::accumulate::{accumulate_bias_single, accumulate_weight_single};

/// Issue #1520 - Fused backprop inner loop for a single neuron.
///
/// Performs weight accumulation for all inbound synapses and bias accumulation
/// in a single WASM call. Returns packed f64 deltas: 7 per synapse + 3 for bias.
///
/// # Arguments
/// * `current_weights` - Current synapse weights (N items)
/// * `target_values` - Target values for weight calculation (N items)
/// * `activations` - Improved from-activations post-recursion (N items)
/// * `plank_constant` - Minimum unit threshold
/// * `learning_rate` - Learning rate for weight/bias adjustment
/// * `max_weight_adj_scale` - Maximum weight adjustment scale
/// * `limit_weight_scale` - Global weight scale limit
/// * `target_pre_activation` - Target pre-activation for bias calculation
/// * `pre_activation` - Current pre-activation for bias calculation
/// * `current_bias` - Current neuron bias
/// * `max_bias_adj_scale` - Maximum bias adjustment scale
/// * `limit_bias_scale` - Global bias scale limit
///
/// # Returns
/// Float64Array with 7*N + 3 values:
///   [count, posAct, negAct, cntPos, cntNeg, posAdj, negAdj] × N
///   followed by [biasCount, totalBias, totalAdjustedBias]
#[wasm_bindgen]
pub fn fused_backprop_neuron(
    current_weights: &[f64],
    target_values: &[f64],
    activations: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
    target_pre_activation: f64,
    pre_activation: f64,
    current_bias: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) -> Vec<f64> {
    let n = current_weights.len();
    let mut result = vec![0.0_f64; 7 * n + 3];

    // Weight accumulation for each synapse
    for i in 0..n {
        let (d_count, d_pos_act, d_neg_act, d_cnt_pos, d_cnt_neg, d_pos_adj, d_neg_adj) =
            accumulate_weight_single(
                current_weights[i],
                target_values[i],
                activations[i],
                plank_constant,
                learning_rate,
                max_weight_adj_scale,
                limit_weight_scale,
            );

        let base = i * 7;
        result[base] = d_count;
        result[base + 1] = d_pos_act;
        result[base + 2] = d_neg_act;
        result[base + 3] = d_cnt_pos;
        result[base + 4] = d_cnt_neg;
        result[base + 5] = d_pos_adj;
        result[base + 6] = d_neg_adj;
    }

    // Bias accumulation
    let (bias_count, total_bias, total_adj_bias) = accumulate_bias_single(
        target_pre_activation,
        pre_activation,
        current_bias,
        plank_constant,
        learning_rate,
        max_bias_adj_scale,
        limit_bias_scale,
    );

    let bias_base = 7 * n;
    result[bias_base] = bias_count;
    result[bias_base + 1] = total_bias;
    result[bias_base + 2] = total_adj_bias;

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fused_backprop_single_synapse() {
        let result = fused_backprop_neuron(
            &[0.5],           // current_weights
            &[2.0],           // target_values
            &[1.0],           // activations
            1e-7,             // plank_constant
            1.0,              // learning_rate
            1.0,              // max_weight_adj_scale
            100000.0,         // limit_weight_scale
            2.0,              // target_pre_activation
            1.0,              // pre_activation
            0.5,              // current_bias
            1.0,              // max_bias_adj_scale
            10000.0,          // limit_bias_scale
        );

        // 7 weight values + 3 bias values = 10
        assert_eq!(result.len(), 10);

        // Weight: positive activation of 1.0
        assert_eq!(result[0], 1.0); // count
        assert_eq!(result[1], 1.0); // positive activation
        assert_eq!(result[2], 0.0); // negative activation
        assert_eq!(result[3], 1.0); // count positive
        assert_eq!(result[4], 0.0); // count negative

        // Bias: delta=1.0, target_bias=1.5
        assert_eq!(result[7], 1.0);  // bias count
        assert_eq!(result[8], 1.5);  // total bias
    }

    #[test]
    fn test_fused_backprop_multiple_synapses() {
        let result = fused_backprop_neuron(
            &[0.5, -0.3, 1.2],  // current_weights
            &[2.0, -1.5, 0.8],  // target_values
            &[1.0, 0.5, -0.8],  // activations
            1e-7,
            1.0,
            1.0,
            100000.0,
            3.0,             // target_pre_activation
            2.0,             // pre_activation
            0.5,             // current_bias
            1.0,
            10000.0,
        );

        // 7*3 + 3 = 24
        assert_eq!(result.len(), 24);

        // First synapse: positive activation
        assert_eq!(result[0], 1.0); // count
        assert_eq!(result[1], 1.0); // positive activation

        // Second synapse: positive activation (0.5 > 0)
        assert_eq!(result[7], 1.0); // count
        assert_eq!(result[8], 0.5); // positive activation

        // Third synapse: negative activation (-0.8)
        assert_eq!(result[14], 1.0); // count
        assert_eq!(result[15], 0.0); // no positive activation
        assert_eq!(result[16], 0.8); // negative activation (abs)

        // Bias delta: 3.0 - 2.0 = 1.0, target_bias = 0.5 + 1.0 = 1.5
        assert_eq!(result[21], 1.0); // bias count
        assert_eq!(result[22], 1.5); // total bias
    }

    #[test]
    fn test_fused_backprop_empty_synapses() {
        let result = fused_backprop_neuron(
            &[],
            &[],
            &[],
            1e-7,
            1.0,
            1.0,
            100000.0,
            2.0,
            1.0,
            0.5,
            1.0,
            10000.0,
        );

        // Only bias: 3 values
        assert_eq!(result.len(), 3);
        assert_eq!(result[0], 1.0);  // bias count
        assert_eq!(result[1], 1.5);  // total bias (0.5 + (2.0 - 1.0))
    }

    #[test]
    fn test_fused_backprop_non_finite_skipped() {
        let result = fused_backprop_neuron(
            &[f64::NAN, 0.5],
            &[2.0, f64::INFINITY],
            &[1.0, 1.0],
            1e-7,
            1.0,
            1.0,
            100000.0,
            f64::NAN,   // non-finite bias target
            1.0,
            0.5,
            1.0,
            10000.0,
        );

        // 7*2 + 3 = 17
        assert_eq!(result.len(), 17);

        // Both synapses should be skipped (NaN weight, Infinity target)
        assert_eq!(result[0], 0.0);  // first: NaN weight → skipped
        assert_eq!(result[7], 0.0);  // second: Infinity target → skipped

        // Bias: NaN target → skipped
        assert_eq!(result[14], 0.0); // bias count = 0
    }

    #[test]
    fn test_fused_matches_individual_calls() {
        // Verify that the fused function produces identical results to calling
        // accumulate_weight_single and accumulate_bias_single individually.
        let weights = [0.5, -0.3, 1.2, 0.0];
        let targets = [2.0, -1.5, 0.8, 3.0];
        let acts = [1.0, 0.5, -0.8, 2.0];
        let plank = 1e-7;
        let lr = 0.8;
        let max_w = 1.5;
        let lim_w = 50000.0;

        let fused = fused_backprop_neuron(
            &weights, &targets, &acts,
            plank, lr, max_w, lim_w,
            5.0, 3.0, 0.7, 2.0, 8000.0,
        );

        for i in 0..4 {
            let (d_count, d_pos_act, d_neg_act, d_cnt_pos, d_cnt_neg, d_pos_adj, d_neg_adj) =
                accumulate_weight_single(
                    weights[i], targets[i], acts[i],
                    plank, lr, max_w, lim_w,
                );

            let base = i * 7;
            assert_eq!(fused[base], d_count, "count mismatch at {}", i);
            assert_eq!(fused[base + 1], d_pos_act, "pos_act mismatch at {}", i);
            assert_eq!(fused[base + 2], d_neg_act, "neg_act mismatch at {}", i);
            assert_eq!(fused[base + 3], d_cnt_pos, "cnt_pos mismatch at {}", i);
            assert_eq!(fused[base + 4], d_cnt_neg, "cnt_neg mismatch at {}", i);
            assert_eq!(fused[base + 5], d_pos_adj, "pos_adj mismatch at {}", i);
            assert_eq!(fused[base + 6], d_neg_adj, "neg_adj mismatch at {}", i);
        }

        let (bias_count, total_bias, total_adj) =
            accumulate_bias_single(5.0, 3.0, 0.7, plank, lr, 2.0, 8000.0);

        let bias_base = 28;
        assert_eq!(fused[bias_base], bias_count, "bias count mismatch");
        assert_eq!(fused[bias_base + 1], total_bias, "total bias mismatch");
        assert_eq!(fused[bias_base + 2], total_adj, "adj bias mismatch");
    }
}

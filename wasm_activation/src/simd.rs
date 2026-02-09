//! SIMD-optimised weighted sum functions for neural network activation.
//!
//! This module provides SIMD-accelerated implementations for computing weighted sums
//! of synapse activations. Issue #1178, #1197, #1202, #1209.
//!
//! ## Optimisation strategies
//!
//! - **Dual accumulator**: Uses two independent SIMD accumulators to hide FMA latency
//!   by allowing out-of-order execution of independent multiply-add chains.
//! - **FMA (fused multiply-add)**: Uses `f32x4_relaxed_madd` from relaxed-simd to
//!   perform multiply and add in a single instruction with better precision.
//! - **Multi-record batching**: Processes the same neuron across 4 or 8 input records
//!   in parallel, amortising weight loads across records.
//! - **SIMD aggregate helpers**: `weighted_sum_of_squares_simd` for Hypotenuse
//!   and `weighted_sum_for_mean_simd` for Mean activation functions.

use crate::network::SynapseData;

// Issue #1178 - WASM SIMD support
// SIMD intrinsics for vectorised synapse weight summation
// Issue #1197 - Added f32x4_relaxed_madd for FMA optimisation
#[cfg(target_arch = "wasm32")]
use core::arch::wasm32::{
    f32x4, f32x4_add, f32x4_extract_lane, f32x4_relaxed_madd, f32x4_splat,
};

/// Issue #1178 - SIMD-optimised weighted sum for standard activations
/// Issue #1197 - Uses FMA (fused multiply-add) via relaxed-simd for better performance
///
/// Uses a dual-accumulator approach: processes 8 synapses per iteration with two
/// independent f32x4 accumulators to hide FMA latency via instruction-level
/// parallelism. Falls back to 4-wide for counts 4..7 and scalar for < 4.
///
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
pub fn weighted_sum_simd(
    synapses: &[SynapseData],
    activations: &[f32],
    start: usize,
    end: usize,
    bias: f32,
) -> f32 {
    let count = end - start;
    if count == 0 {
        return bias;
    }

    // For very small counts, scalar is faster due to SIMD setup overhead
    if count < 4 {
        let mut sum = bias;
        for i in start..end {
            let synapse = &synapses[i];
            sum += activations[synapse.from_index as usize] * synapse.weight;
        }
        return sum;
    }

    // Dual-accumulator approach: two independent accumulators hide FMA latency
    // by allowing out-of-order execution of independent dependency chains.
    let mut acc0 = f32x4_splat(0.0);
    let mut acc1 = f32x4_splat(0.0);
    let mut scalar_sum = bias;

    // Process in chunks of 8 (two groups of 4) for dual accumulation
    let chunks_of_8 = count / 8;
    let mut i = start;

    for _ in 0..chunks_of_8 {
        // First group of 4 -> acc0
        let s0 = &synapses[i];
        let s1 = &synapses[i + 1];
        let s2 = &synapses[i + 2];
        let s3 = &synapses[i + 3];
        let weights0 = f32x4(s0.weight, s1.weight, s2.weight, s3.weight);
        let acts0 = f32x4(
            activations[s0.from_index as usize],
            activations[s1.from_index as usize],
            activations[s2.from_index as usize],
            activations[s3.from_index as usize],
        );
        acc0 = f32x4_relaxed_madd(weights0, acts0, acc0);

        // Second group of 4 -> acc1 (independent chain)
        let s4 = &synapses[i + 4];
        let s5 = &synapses[i + 5];
        let s6 = &synapses[i + 6];
        let s7 = &synapses[i + 7];
        let weights1 = f32x4(s4.weight, s5.weight, s6.weight, s7.weight);
        let acts1 = f32x4(
            activations[s4.from_index as usize],
            activations[s5.from_index as usize],
            activations[s6.from_index as usize],
            activations[s7.from_index as usize],
        );
        acc1 = f32x4_relaxed_madd(weights1, acts1, acc1);

        i += 8;
    }

    // Handle remaining chunk of 4 if present
    let remaining = end - i;
    if remaining >= 4 {
        let s0 = &synapses[i];
        let s1 = &synapses[i + 1];
        let s2 = &synapses[i + 2];
        let s3 = &synapses[i + 3];
        let weights = f32x4(s0.weight, s1.weight, s2.weight, s3.weight);
        let acts = f32x4(
            activations[s0.from_index as usize],
            activations[s1.from_index as usize],
            activations[s2.from_index as usize],
            activations[s3.from_index as usize],
        );
        acc0 = f32x4_relaxed_madd(weights, acts, acc0);
        i += 4;
    }

    // Merge accumulators
    let merged = f32x4_add(acc0, acc1);

    // Horizontal sum of merged SIMD accumulator
    scalar_sum += f32x4_extract_lane::<0>(merged)
        + f32x4_extract_lane::<1>(merged)
        + f32x4_extract_lane::<2>(merged)
        + f32x4_extract_lane::<3>(merged);

    // Handle scalar remainder (0-3 synapses)
    for idx in i..end {
        let synapse = &synapses[idx];
        scalar_sum += activations[synapse.from_index as usize] * synapse.weight;
    }

    scalar_sum
}

/// Issue #1178 - SIMD-optimised sum of squared weighted activations for Hypotenuse.
///
/// Computes sum((activation[from] * weight)^2) using SIMD with dual accumulators.
/// Used by the Hypotenuse squash function: sqrt(sum_sq) + bias.
///
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
pub fn weighted_sum_of_squares_simd(
    synapses: &[SynapseData],
    activations: &[f32],
    start: usize,
    end: usize,
) -> f32 {
    let count = end - start;
    if count == 0 {
        return 0.0;
    }

    if count < 4 {
        let mut sum_sq = 0.0f32;
        for i in start..end {
            let synapse = &synapses[i];
            let val = activations[synapse.from_index as usize] * synapse.weight;
            sum_sq += val * val;
        }
        return sum_sq;
    }

    let mut acc = f32x4_splat(0.0);
    let mut scalar_sum = 0.0f32;
    let chunks = count / 4;

    for chunk in 0..chunks {
        let base = start + chunk * 4;
        let s0 = &synapses[base];
        let s1 = &synapses[base + 1];
        let s2 = &synapses[base + 2];
        let s3 = &synapses[base + 3];

        // Compute weighted activations
        let products = f32x4(
            activations[s0.from_index as usize] * s0.weight,
            activations[s1.from_index as usize] * s1.weight,
            activations[s2.from_index as usize] * s2.weight,
            activations[s3.from_index as usize] * s3.weight,
        );

        // Square and accumulate: acc += products * products
        acc = f32x4_relaxed_madd(products, products, acc);
    }

    scalar_sum += f32x4_extract_lane::<0>(acc)
        + f32x4_extract_lane::<1>(acc)
        + f32x4_extract_lane::<2>(acc)
        + f32x4_extract_lane::<3>(acc);

    let remainder_start = start + chunks * 4;
    for i in remainder_start..end {
        let synapse = &synapses[i];
        let val = activations[synapse.from_index as usize] * synapse.weight;
        scalar_sum += val * val;
    }

    scalar_sum
}

/// Issue #1178 - SIMD-optimised weighted sum for Mean activation.
///
/// Computes the plain weighted sum (without bias) using SIMD, intended for
/// the Mean squash: sum / n + bias. Shares the dual-accumulator approach
/// with `weighted_sum_simd` but omits the bias to keep the division clean.
///
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
pub fn weighted_sum_no_bias_simd(
    synapses: &[SynapseData],
    activations: &[f32],
    start: usize,
    end: usize,
) -> f32 {
    let count = end - start;
    if count == 0 {
        return 0.0;
    }

    if count < 4 {
        let mut sum = 0.0f32;
        for i in start..end {
            let synapse = &synapses[i];
            sum += activations[synapse.from_index as usize] * synapse.weight;
        }
        return sum;
    }

    let mut acc = f32x4_splat(0.0);
    let mut scalar_sum = 0.0f32;
    let chunks = count / 4;

    for chunk in 0..chunks {
        let base = start + chunk * 4;
        let s0 = &synapses[base];
        let s1 = &synapses[base + 1];
        let s2 = &synapses[base + 2];
        let s3 = &synapses[base + 3];

        let weights = f32x4(s0.weight, s1.weight, s2.weight, s3.weight);
        let acts = f32x4(
            activations[s0.from_index as usize],
            activations[s1.from_index as usize],
            activations[s2.from_index as usize],
            activations[s3.from_index as usize],
        );
        acc = f32x4_relaxed_madd(weights, acts, acc);
    }

    scalar_sum += f32x4_extract_lane::<0>(acc)
        + f32x4_extract_lane::<1>(acc)
        + f32x4_extract_lane::<2>(acc)
        + f32x4_extract_lane::<3>(acc);

    let remainder_start = start + chunks * 4;
    for i in remainder_start..end {
        let synapse = &synapses[i];
        scalar_sum += activations[synapse.from_index as usize] * synapse.weight;
    }

    scalar_sum
}

/// Issue #1178 - SIMD-optimised sum of squared (bias + weighted activation) for HypotenuseV2.
///
/// Computes sum((bias + activation[from] * weight)^2) using SIMD.
/// Used by the HypotenuseV2 squash function: sqrt(sum_sq).
///
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
pub fn weighted_sum_of_squares_v2_simd(
    synapses: &[SynapseData],
    activations: &[f32],
    start: usize,
    end: usize,
    bias: f32,
) -> f32 {
    let count = end - start;
    if count == 0 {
        return 0.0;
    }

    if count < 4 {
        let mut sum_sq = 0.0f32;
        for i in start..end {
            let synapse = &synapses[i];
            let val = bias + activations[synapse.from_index as usize] * synapse.weight;
            sum_sq += val * val;
        }
        return sum_sq;
    }

    let bias_vec = f32x4_splat(bias);
    let mut acc = f32x4_splat(0.0);
    let mut scalar_sum = 0.0f32;
    let chunks = count / 4;

    for chunk in 0..chunks {
        let base = start + chunk * 4;
        let s0 = &synapses[base];
        let s1 = &synapses[base + 1];
        let s2 = &synapses[base + 2];
        let s3 = &synapses[base + 3];

        // Compute bias + activation * weight
        let weighted = f32x4(
            activations[s0.from_index as usize] * s0.weight,
            activations[s1.from_index as usize] * s1.weight,
            activations[s2.from_index as usize] * s2.weight,
            activations[s3.from_index as usize] * s3.weight,
        );
        let vals = f32x4_add(bias_vec, weighted);

        // Square and accumulate: acc += vals * vals
        acc = f32x4_relaxed_madd(vals, vals, acc);
    }

    scalar_sum += f32x4_extract_lane::<0>(acc)
        + f32x4_extract_lane::<1>(acc)
        + f32x4_extract_lane::<2>(acc)
        + f32x4_extract_lane::<3>(acc);

    let remainder_start = start + chunks * 4;
    for i in remainder_start..end {
        let synapse = &synapses[i];
        let val = bias + activations[synapse.from_index as usize] * synapse.weight;
        scalar_sum += val * val;
    }

    scalar_sum
}

/// Issue #1202 - SIMD-optimised weighted sum for 4 records simultaneously.
///
/// Processes the same neuron for 4 different records in parallel using SIMD.
/// Each record has its own activation buffer, but weights are shared.
///
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
pub fn weighted_sum_simd_4records(
    synapses: &[SynapseData],
    act0: &[f32],
    act1: &[f32],
    act2: &[f32],
    act3: &[f32],
    start: usize,
    end: usize,
    bias: f32,
) -> (f32, f32, f32, f32) {
    let count = end - start;
    if count == 0 {
        return (bias, bias, bias, bias);
    }

    // Initialise accumulators with bias for all 4 records
    let mut acc = f32x4_splat(bias);

    // Process each synapse, gathering activations from all 4 records
    for i in start..end {
        let synapse = &synapses[i];
        let from = synapse.from_index as usize;
        let weight = synapse.weight;

        // Gather activations from 4 different records at the same position
        let acts = f32x4(act0[from], act1[from], act2[from], act3[from]);

        // Broadcast weight to all 4 lanes
        let weights = f32x4_splat(weight);

        // FMA: acc = weights * acts + acc
        acc = f32x4_relaxed_madd(weights, acts, acc);
    }

    // Extract results for all 4 records
    (
        f32x4_extract_lane::<0>(acc),
        f32x4_extract_lane::<1>(acc),
        f32x4_extract_lane::<2>(acc),
        f32x4_extract_lane::<3>(acc),
    )
}

/// Issue #1209 - SIMD-optimised weighted sum for 8 records simultaneously.
///
/// Processes the same neuron for 8 different records in parallel using two SIMD accumulators.
/// Each record has its own activation buffer, but weights are shared.
/// This extends the 4-record approach (Issue #1202) by stacking two v128 operations
/// for better cache utilisation and amortised overhead.
///
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
#[allow(clippy::too_many_arguments)]
pub fn weighted_sum_simd_8records(
    synapses: &[SynapseData],
    act0: &[f32],
    act1: &[f32],
    act2: &[f32],
    act3: &[f32],
    act4: &[f32],
    act5: &[f32],
    act6: &[f32],
    act7: &[f32],
    start: usize,
    end: usize,
    bias: f32,
) -> (f32, f32, f32, f32, f32, f32, f32, f32) {
    let count = end - start;
    if count == 0 {
        return (bias, bias, bias, bias, bias, bias, bias, bias);
    }

    // Initialise accumulators with bias for all 8 records (two SIMD vectors)
    let mut acc_0_3 = f32x4_splat(bias);
    let mut acc_4_7 = f32x4_splat(bias);

    // Process each synapse, gathering activations from all 8 records
    for i in start..end {
        let synapse = &synapses[i];
        let from = synapse.from_index as usize;
        let weight = synapse.weight;

        // Gather activations from 8 different records at the same position
        let acts_0_3 = f32x4(act0[from], act1[from], act2[from], act3[from]);
        let acts_4_7 = f32x4(act4[from], act5[from], act6[from], act7[from]);

        // Broadcast weight to all lanes
        let weights = f32x4_splat(weight);

        // FMA: acc = weights * acts + acc
        acc_0_3 = f32x4_relaxed_madd(weights, acts_0_3, acc_0_3);
        acc_4_7 = f32x4_relaxed_madd(weights, acts_4_7, acc_4_7);
    }

    // Extract results for all 8 records
    (
        f32x4_extract_lane::<0>(acc_0_3),
        f32x4_extract_lane::<1>(acc_0_3),
        f32x4_extract_lane::<2>(acc_0_3),
        f32x4_extract_lane::<3>(acc_0_3),
        f32x4_extract_lane::<0>(acc_4_7),
        f32x4_extract_lane::<1>(acc_4_7),
        f32x4_extract_lane::<2>(acc_4_7),
        f32x4_extract_lane::<3>(acc_4_7),
    )
}

/// Scalar fallback for non-WASM targets (for testing)
#[cfg(not(target_arch = "wasm32"))]
#[inline]
#[allow(clippy::too_many_arguments)]
pub fn weighted_sum_simd_8records(
    synapses: &[SynapseData],
    act0: &[f32],
    act1: &[f32],
    act2: &[f32],
    act3: &[f32],
    act4: &[f32],
    act5: &[f32],
    act6: &[f32],
    act7: &[f32],
    start: usize,
    end: usize,
    bias: f32,
) -> (f32, f32, f32, f32, f32, f32, f32, f32) {
    let mut sum0 = bias;
    let mut sum1 = bias;
    let mut sum2 = bias;
    let mut sum3 = bias;
    let mut sum4 = bias;
    let mut sum5 = bias;
    let mut sum6 = bias;
    let mut sum7 = bias;
    for synapse in synapses.iter().take(end).skip(start) {
        let from = synapse.from_index as usize;
        let w = synapse.weight;
        sum0 += act0[from] * w;
        sum1 += act1[from] * w;
        sum2 += act2[from] * w;
        sum3 += act3[from] * w;
        sum4 += act4[from] * w;
        sum5 += act5[from] * w;
        sum6 += act6[from] * w;
        sum7 += act7[from] * w;
    }
    (sum0, sum1, sum2, sum3, sum4, sum5, sum6, sum7)
}

/// Scalar fallback for non-WASM targets (for testing)
#[cfg(not(target_arch = "wasm32"))]
#[inline]
#[allow(clippy::too_many_arguments)]
pub fn weighted_sum_simd_4records(
    synapses: &[SynapseData],
    act0: &[f32],
    act1: &[f32],
    act2: &[f32],
    act3: &[f32],
    start: usize,
    end: usize,
    bias: f32,
) -> (f32, f32, f32, f32) {
    let mut sum0 = bias;
    let mut sum1 = bias;
    let mut sum2 = bias;
    let mut sum3 = bias;
    for synapse in synapses.iter().take(end).skip(start) {
        let from = synapse.from_index as usize;
        let w = synapse.weight;
        sum0 += act0[from] * w;
        sum1 += act1[from] * w;
        sum2 += act2[from] * w;
        sum3 += act3[from] * w;
    }
    (sum0, sum1, sum2, sum3)
}

/// Scalar fallback for non-WASM targets (for testing)
#[cfg(not(target_arch = "wasm32"))]
#[inline]
pub fn weighted_sum_simd(
    synapses: &[SynapseData],
    activations: &[f32],
    start: usize,
    end: usize,
    bias: f32,
) -> f32 {
    let mut sum = bias;
    for synapse in synapses.iter().take(end).skip(start) {
        sum += activations[synapse.from_index as usize] * synapse.weight;
    }
    sum
}

/// Scalar fallback for non-WASM targets (for testing)
/// Issue #1178 - Sum of squares for Hypotenuse
#[cfg(not(target_arch = "wasm32"))]
#[inline]
pub fn weighted_sum_of_squares_simd(
    synapses: &[SynapseData],
    activations: &[f32],
    start: usize,
    end: usize,
) -> f32 {
    let mut sum_sq = 0.0f32;
    for synapse in synapses.iter().take(end).skip(start) {
        let val = activations[synapse.from_index as usize] * synapse.weight;
        sum_sq += val * val;
    }
    sum_sq
}

/// Scalar fallback for non-WASM targets (for testing)
/// Issue #1178 - Weighted sum without bias for Mean
#[cfg(not(target_arch = "wasm32"))]
#[inline]
pub fn weighted_sum_no_bias_simd(
    synapses: &[SynapseData],
    activations: &[f32],
    start: usize,
    end: usize,
) -> f32 {
    let mut sum = 0.0f32;
    for synapse in synapses.iter().take(end).skip(start) {
        sum += activations[synapse.from_index as usize] * synapse.weight;
    }
    sum
}

/// Scalar fallback for non-WASM targets (for testing)
/// Issue #1178 - Sum of squares V2 for HypotenuseV2
#[cfg(not(target_arch = "wasm32"))]
#[inline]
pub fn weighted_sum_of_squares_v2_simd(
    synapses: &[SynapseData],
    activations: &[f32],
    start: usize,
    end: usize,
    bias: f32,
) -> f32 {
    let mut sum_sq = 0.0f32;
    for synapse in synapses.iter().take(end).skip(start) {
        let val = bias + activations[synapse.from_index as usize] * synapse.weight;
        sum_sq += val * val;
    }
    sum_sq
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to create test synapse data
    fn make_synapse(from_index: u32, weight: f32) -> SynapseData {
        SynapseData {
            weight,
            from_index,
            synapse_type: 0,
            _padding: [0; 3],
        }
    }

    /// Helper to compute expected weighted sum via naive scalar loop
    fn naive_weighted_sum(
        synapses: &[SynapseData],
        activations: &[f32],
        start: usize,
        end: usize,
        bias: f32,
    ) -> f32 {
        let mut sum = bias;
        for synapse in synapses.iter().take(end).skip(start) {
            sum += activations[synapse.from_index as usize] * synapse.weight;
        }
        sum
    }

    #[test]
    fn test_weighted_sum_empty() {
        let synapses: Vec<SynapseData> = vec![];
        let activations: Vec<f32> = vec![1.0, 2.0, 3.0];
        let result = weighted_sum_simd(&synapses, &activations, 0, 0, 0.5);
        assert!((result - 0.5).abs() < 1e-6, "Empty synapse range should return bias");
    }

    #[test]
    fn test_weighted_sum_single_synapse() {
        let synapses = vec![make_synapse(1, 0.5)];
        let activations = vec![0.0, 2.0, 0.0];
        let result = weighted_sum_simd(&synapses, &activations, 0, 1, 1.0);
        // Expected: 1.0 + 2.0 * 0.5 = 2.0
        assert!((result - 2.0).abs() < 1e-6, "Single synapse result mismatch: {result}");
    }

    #[test]
    fn test_weighted_sum_three_synapses() {
        // Exercises the scalar fallback path (count < 4)
        let synapses = vec![
            make_synapse(0, 1.0),
            make_synapse(1, 2.0),
            make_synapse(2, 3.0),
        ];
        let activations = vec![1.0, 2.0, 3.0];
        let result = weighted_sum_simd(&synapses, &activations, 0, 3, 0.0);
        // Expected: 1*1 + 2*2 + 3*3 = 1 + 4 + 9 = 14
        let expected = naive_weighted_sum(&synapses, &activations, 0, 3, 0.0);
        assert!((result - expected).abs() < 1e-5, "3 synapses: got {result}, expected {expected}");
    }

    #[test]
    fn test_weighted_sum_exactly_four() {
        // Exercises the SIMD path with no remainder
        let synapses = vec![
            make_synapse(0, 0.5),
            make_synapse(1, -0.5),
            make_synapse(2, 1.0),
            make_synapse(3, -1.0),
        ];
        let activations = vec![2.0, 2.0, 3.0, 3.0];
        let result = weighted_sum_simd(&synapses, &activations, 0, 4, 0.1);
        let expected = naive_weighted_sum(&synapses, &activations, 0, 4, 0.1);
        assert!(
            (result - expected).abs() < 1e-5,
            "4 synapses: got {result}, expected {expected}"
        );
    }

    #[test]
    fn test_weighted_sum_five_synapses() {
        // Exercises the SIMD path with 1 remainder
        let synapses: Vec<SynapseData> = (0..5)
            .map(|i| make_synapse(i, (i as f32 + 1.0) * 0.1))
            .collect();
        let activations: Vec<f32> = (0..5).map(|i| i as f32 * 0.5).collect();
        let result = weighted_sum_simd(&synapses, &activations, 0, 5, -0.3);
        let expected = naive_weighted_sum(&synapses, &activations, 0, 5, -0.3);
        assert!(
            (result - expected).abs() < 1e-4,
            "5 synapses: got {result}, expected {expected}"
        );
    }

    #[test]
    fn test_weighted_sum_eight_synapses() {
        // Exercises the dual-accumulator path (exactly 8 = one chunk of 8)
        let synapses: Vec<SynapseData> = (0..8)
            .map(|i| make_synapse(i, (i as f32 - 3.5) * 0.2))
            .collect();
        let activations: Vec<f32> = (0..8).map(|i| (i as f32).sin()).collect();
        let result = weighted_sum_simd(&synapses, &activations, 0, 8, 0.0);
        let expected = naive_weighted_sum(&synapses, &activations, 0, 8, 0.0);
        assert!(
            (result - expected).abs() < 1e-4,
            "8 synapses: got {result}, expected {expected}"
        );
    }

    #[test]
    fn test_weighted_sum_large() {
        // Test with many synapses to exercise both dual-accumulator and remainder
        let n = 25; // Typical average synapses per neuron in production
        let synapses: Vec<SynapseData> = (0..n)
            .map(|i| make_synapse(i % 10, ((i as f32) * 0.7).sin()))
            .collect();
        let activations: Vec<f32> = (0..10).map(|i| (i as f32 * 0.3).cos()).collect();
        let result = weighted_sum_simd(&synapses, &activations, 0, n as usize, 0.5);
        let expected = naive_weighted_sum(&synapses, &activations, 0, n as usize, 0.5);
        assert!(
            (result - expected).abs() < 1e-3,
            "25 synapses: got {result}, expected {expected}"
        );
    }

    #[test]
    fn test_weighted_sum_with_offset() {
        // Test partial range (start > 0)
        let synapses: Vec<SynapseData> = (0..10)
            .map(|i| make_synapse(i % 5, i as f32 * 0.1))
            .collect();
        let activations: Vec<f32> = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = weighted_sum_simd(&synapses, &activations, 3, 9, 1.0);
        let expected = naive_weighted_sum(&synapses, &activations, 3, 9, 1.0);
        assert!(
            (result - expected).abs() < 1e-4,
            "Offset range: got {result}, expected {expected}"
        );
    }

    #[test]
    fn test_weighted_sum_negative_weights_and_activations() {
        let synapses = vec![
            make_synapse(0, -1.5),
            make_synapse(1, 2.5),
            make_synapse(2, -0.5),
            make_synapse(3, 1.5),
        ];
        let activations = vec![-1.0, -2.0, 3.0, -4.0];
        let result = weighted_sum_simd(&synapses, &activations, 0, 4, 0.0);
        let expected = naive_weighted_sum(&synapses, &activations, 0, 4, 0.0);
        assert!(
            (result - expected).abs() < 1e-5,
            "Negative values: got {result}, expected {expected}"
        );
    }

    #[test]
    fn test_weighted_sum_of_squares_empty() {
        let synapses: Vec<SynapseData> = vec![];
        let activations: Vec<f32> = vec![1.0];
        let result = weighted_sum_of_squares_simd(&synapses, &activations, 0, 0);
        assert!((result).abs() < 1e-6, "Empty should return 0");
    }

    #[test]
    fn test_weighted_sum_of_squares_basic() {
        let synapses = vec![
            make_synapse(0, 2.0),
            make_synapse(1, 3.0),
        ];
        let activations = vec![1.0, 2.0];
        let result = weighted_sum_of_squares_simd(&synapses, &activations, 0, 2);
        // (1*2)^2 + (2*3)^2 = 4 + 36 = 40
        assert!((result - 40.0).abs() < 1e-4, "Sum of squares: got {result}, expected 40.0");
    }

    #[test]
    fn test_weighted_sum_of_squares_simd_path() {
        // 5 synapses: exercises SIMD (4) + scalar remainder (1)
        let synapses: Vec<SynapseData> = (0..5)
            .map(|i| make_synapse(i, (i as f32 + 1.0) * 0.5))
            .collect();
        let activations: Vec<f32> = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let result = weighted_sum_of_squares_simd(&synapses, &activations, 0, 5);

        let mut expected = 0.0f32;
        for i in 0..5 {
            let val = activations[i] * synapses[i].weight;
            expected += val * val;
        }
        assert!(
            (result - expected).abs() < 1e-3,
            "Sum of squares SIMD: got {result}, expected {expected}"
        );
    }

    #[test]
    fn test_weighted_sum_no_bias_empty() {
        let synapses: Vec<SynapseData> = vec![];
        let activations: Vec<f32> = vec![1.0];
        let result = weighted_sum_no_bias_simd(&synapses, &activations, 0, 0);
        assert!((result).abs() < 1e-6, "Empty should return 0");
    }

    #[test]
    fn test_weighted_sum_no_bias_basic() {
        let synapses = vec![
            make_synapse(0, 1.0),
            make_synapse(1, 2.0),
            make_synapse(2, 3.0),
            make_synapse(3, 4.0),
        ];
        let activations = vec![1.0, 1.0, 1.0, 1.0];
        let result = weighted_sum_no_bias_simd(&synapses, &activations, 0, 4);
        // 1*1 + 1*2 + 1*3 + 1*4 = 10
        assert!((result - 10.0).abs() < 1e-5, "No bias sum: got {result}, expected 10.0");
    }

    #[test]
    fn test_weighted_sum_of_squares_v2_basic() {
        let synapses = vec![
            make_synapse(0, 1.0),
            make_synapse(1, 2.0),
        ];
        let activations = vec![1.0, 2.0];
        let bias = 0.5;
        let result = weighted_sum_of_squares_v2_simd(&synapses, &activations, 0, 2, bias);
        // (0.5 + 1*1)^2 + (0.5 + 2*2)^2 = 1.5^2 + 4.5^2 = 2.25 + 20.25 = 22.5
        assert!(
            (result - 22.5).abs() < 1e-4,
            "Sum of squares V2: got {result}, expected 22.5"
        );
    }

    #[test]
    fn test_weighted_sum_of_squares_v2_simd_path() {
        let synapses: Vec<SynapseData> = (0..5)
            .map(|i| make_synapse(i, 1.0))
            .collect();
        let activations: Vec<f32> = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let bias = -1.0;
        let result = weighted_sum_of_squares_v2_simd(&synapses, &activations, 0, 5, bias);

        let mut expected = 0.0f32;
        for i in 0..5 {
            let val = bias + activations[i] * synapses[i].weight;
            expected += val * val;
        }
        assert!(
            (result - expected).abs() < 1e-3,
            "Sum of squares V2 SIMD: got {result}, expected {expected}"
        );
    }

    #[test]
    fn test_4records_basic() {
        let synapses = vec![
            make_synapse(0, 1.0),
            make_synapse(1, 2.0),
        ];
        let act0 = vec![1.0, 2.0];
        let act1 = vec![3.0, 4.0];
        let act2 = vec![5.0, 6.0];
        let act3 = vec![7.0, 8.0];
        let (r0, r1, r2, r3) =
            weighted_sum_simd_4records(&synapses, &act0, &act1, &act2, &act3, 0, 2, 0.5);

        // Record 0: 0.5 + 1*1 + 2*2 = 5.5
        assert!((r0 - 5.5).abs() < 1e-5, "4records r0: got {r0}, expected 5.5");
        // Record 1: 0.5 + 3*1 + 4*2 = 11.5
        assert!((r1 - 11.5).abs() < 1e-5, "4records r1: got {r1}, expected 11.5");
        // Record 2: 0.5 + 5*1 + 6*2 = 17.5
        assert!((r2 - 17.5).abs() < 1e-5, "4records r2: got {r2}, expected 17.5");
        // Record 3: 0.5 + 7*1 + 8*2 = 23.5
        assert!((r3 - 23.5).abs() < 1e-5, "4records r3: got {r3}, expected 23.5");
    }

    #[test]
    fn test_4records_empty() {
        let synapses: Vec<SynapseData> = vec![];
        let act = vec![1.0];
        let (r0, r1, r2, r3) =
            weighted_sum_simd_4records(&synapses, &act, &act, &act, &act, 0, 0, 2.0);
        assert!((r0 - 2.0).abs() < 1e-6);
        assert!((r1 - 2.0).abs() < 1e-6);
        assert!((r2 - 2.0).abs() < 1e-6);
        assert!((r3 - 2.0).abs() < 1e-6);
    }

    #[test]
    fn test_8records_basic() {
        let synapses = vec![make_synapse(0, 2.0)];
        let make_act = |v: f32| vec![v];
        let a0 = make_act(1.0);
        let a1 = make_act(2.0);
        let a2 = make_act(3.0);
        let a3 = make_act(4.0);
        let a4 = make_act(5.0);
        let a5 = make_act(6.0);
        let a6 = make_act(7.0);
        let a7 = make_act(8.0);
        let (r0, r1, r2, r3, r4, r5, r6, r7) = weighted_sum_simd_8records(
            &synapses, &a0, &a1, &a2, &a3, &a4, &a5, &a6, &a7, 0, 1, 0.0,
        );
        // Each: bias(0) + activation * weight(2)
        assert!((r0 - 2.0).abs() < 1e-5);
        assert!((r1 - 4.0).abs() < 1e-5);
        assert!((r2 - 6.0).abs() < 1e-5);
        assert!((r3 - 8.0).abs() < 1e-5);
        assert!((r4 - 10.0).abs() < 1e-5);
        assert!((r5 - 12.0).abs() < 1e-5);
        assert!((r6 - 14.0).abs() < 1e-5);
        assert!((r7 - 16.0).abs() < 1e-5);
    }

    #[test]
    fn test_8records_empty() {
        let synapses: Vec<SynapseData> = vec![];
        let act = vec![1.0];
        let (r0, r1, r2, r3, r4, r5, r6, r7) = weighted_sum_simd_8records(
            &synapses, &act, &act, &act, &act, &act, &act, &act, &act, 0, 0, 3.0,
        );
        for r in [r0, r1, r2, r3, r4, r5, r6, r7] {
            assert!((r - 3.0).abs() < 1e-6);
        }
    }
}

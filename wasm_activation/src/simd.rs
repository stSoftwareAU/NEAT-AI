//! SIMD-optimised weighted sum functions for neural network activation.
//!
//! This module provides SIMD-accelerated implementations for computing weighted sums
//! of synapse activations. Issue #1178, #1197, #1202, #1209.

use crate::network::SynapseData;

// Issue #1178 - WASM SIMD support
// SIMD intrinsics for vectorised synapse weight summation
// Issue #1197 - Added f32x4_relaxed_madd for FMA optimisation
#[cfg(target_arch = "wasm32")]
use core::arch::wasm32::{f32x4, f32x4_extract_lane, f32x4_relaxed_madd, f32x4_splat};

/// Issue #1178 - SIMD-optimised weighted sum for standard activations
/// Issue #1197 - Uses FMA (fused multiply-add) via relaxed-simd for better performance
///
/// Processes synapses in batches of 4 using 128-bit SIMD operations with FMA.
/// Falls back to scalar for remaining synapses.
///
/// # Safety
/// This function uses SIMD intrinsics and must be called with valid indices.
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
pub unsafe fn weighted_sum_simd(
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

    // Process in chunks of 4 using SIMD
    let chunks = count / 4;

    // Initialise accumulator with zeros
    let mut acc = f32x4_splat(0.0);
    let mut scalar_sum = bias;

    // SIMD loop: process 4 synapses at a time using FMA
    for chunk in 0..chunks {
        let base = start + chunk * 4;

        // Load 4 weights (contiguous in memory due to SynapseData layout)
        let s0 = &synapses[base];
        let s1 = &synapses[base + 1];
        let s2 = &synapses[base + 2];
        let s3 = &synapses[base + 3];

        let weights = f32x4(s0.weight, s1.weight, s2.weight, s3.weight);

        // Gather 4 activations (scatter/gather pattern - must be scalar)
        let a0 = activations[s0.from_index as usize];
        let a1 = activations[s1.from_index as usize];
        let a2 = activations[s2.from_index as usize];
        let a3 = activations[s3.from_index as usize];

        let acts = f32x4(a0, a1, a2, a3);

        // Issue #1197 - Use FMA: acc = weights * acts + acc (single instruction)
        // This replaces the previous: acc = f32x4_add(acc, f32x4_mul(weights, acts))
        acc = f32x4_relaxed_madd(weights, acts, acc);
    }

    // Horizontal sum of SIMD accumulator
    scalar_sum += f32x4_extract_lane::<0>(acc)
        + f32x4_extract_lane::<1>(acc)
        + f32x4_extract_lane::<2>(acc)
        + f32x4_extract_lane::<3>(acc);

    // Handle remainder with scalar operations
    let remainder_start = start + chunks * 4;
    for i in remainder_start..end {
        let synapse = &synapses[i];
        scalar_sum += activations[synapse.from_index as usize] * synapse.weight;
    }

    scalar_sum
}

/// Issue #1202 - SIMD-optimised weighted sum for 4 records simultaneously.
///
/// Processes the same neuron for 4 different records in parallel using SIMD.
/// Each record has its own activation buffer, but weights are shared.
///
/// # Safety
/// This function uses SIMD intrinsics and must be called with valid indices.
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
pub unsafe fn weighted_sum_simd_4records(
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
/// # Safety
/// This function uses SIMD intrinsics and must be called with valid indices.
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
#[allow(clippy::too_many_arguments)]
pub unsafe fn weighted_sum_simd_8records(
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

//! Issue #1519 - Standalone elastic error distribution in WASM.
//!
//! Migrates `distributeElasticError` from TypeScript to Rust/WASM with SIMD
//! acceleration for the scoring pass. Includes the three-pass algorithm:
//! 1. Score calculation: activation² × clamp(safeZoneFactor, 0, 1)
//! 2. Weight-based fallback when activations are near zero
//! 3. Share calculation with floating-point residue redistribution

use wasm_bindgen::prelude::*;

/// Planck constant for floating-point comparisons (matches TypeScript default).
const PLANK_CONSTANT: f32 = 1e-12;

/// SIMD-accelerated scoring pass: computes activation² × clamped safeZoneFactor.
///
/// Uses WASM SIMD128 to process 4 elements at a time for the squaring and
/// multiplication, with a scalar fallback for non-WASM targets.
#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128", enable = "relaxed-simd")]
#[inline]
fn score_pass_simd(
    activations: &[f32],
    safe_zone_factors: &[f32],
    scores: &mut [f32],
) -> f32 {
    use core::arch::wasm32::{
        f32x4, f32x4_add, f32x4_extract_lane, f32x4_max, f32x4_min,
        f32x4_mul, f32x4_splat,
    };

    let count = activations.len();
    let mut denom: f32 = 0.0;

    let chunks = count / 4;
    let zero = f32x4_splat(0.0);
    let one = f32x4_splat(1.0);
    let mut acc = f32x4_splat(0.0);

    for chunk in 0..chunks {
        let base = chunk * 4;

        let act = f32x4(
            activations[base],
            activations[base + 1],
            activations[base + 2],
            activations[base + 3],
        );
        let safe = f32x4(
            safe_zone_factors[base],
            safe_zone_factors[base + 1],
            safe_zone_factors[base + 2],
            safe_zone_factors[base + 3],
        );

        // Check for non-finite values — treat as zero score
        // SIMD doesn't have is_finite, so we handle NaN/Inf by clamping
        // and relying on NaN propagation (NaN * anything = NaN, which won't
        // compare > best_score in the residue pass)

        // clamp(safe, 0, 1)
        let clamped = f32x4_min(f32x4_max(safe, zero), one);

        // activation²
        let a2 = f32x4_mul(act, act);

        // score = a2 * clamped_safe
        let score = f32x4_mul(a2, clamped);

        // Store scores
        scores[base] = f32x4_extract_lane::<0>(score);
        scores[base + 1] = f32x4_extract_lane::<1>(score);
        scores[base + 2] = f32x4_extract_lane::<2>(score);
        scores[base + 3] = f32x4_extract_lane::<3>(score);

        // Accumulate denominator
        acc = f32x4_add(acc, score);
    }

    denom += f32x4_extract_lane::<0>(acc)
        + f32x4_extract_lane::<1>(acc)
        + f32x4_extract_lane::<2>(acc)
        + f32x4_extract_lane::<3>(acc);

    // Handle NaN/Inf in SIMD results and scalar remainder
    let remainder_start = chunks * 4;
    for i in remainder_start..count {
        let activation = activations[i];
        let safe = safe_zone_factors[i];

        if !activation.is_finite() || !safe.is_finite() {
            scores[i] = 0.0;
            continue;
        }

        let clamped_safe = safe.clamp(0.0, 1.0);
        let a2 = activation * activation;
        let score = a2 * clamped_safe;
        scores[i] = score;
        denom += score;
    }

    // Fix up any NaN scores from SIMD pass
    for i in 0..remainder_start {
        if !scores[i].is_finite() {
            denom -= scores[i]; // NaN subtraction won't help, but score was 0 effectively
            scores[i] = 0.0;
        }
    }

    // If denom became NaN due to NaN scores, reset it
    if !denom.is_finite() {
        denom = 0.0;
        for &s in scores.iter() {
            denom += s;
        }
    }

    denom
}

/// Scalar fallback scoring pass for non-WASM targets (testing).
#[cfg(not(target_arch = "wasm32"))]
#[inline]
fn score_pass_simd(
    activations: &[f32],
    safe_zone_factors: &[f32],
    scores: &mut [f32],
) -> f32 {
    let count = activations.len();
    let mut denom: f32 = 0.0;

    for i in 0..count {
        let activation = activations[i];
        let safe = safe_zone_factors[i];

        if !activation.is_finite() || !safe.is_finite() {
            scores[i] = 0.0;
            continue;
        }

        let clamped_safe = safe.clamp(0.0, 1.0);
        let a2 = activation * activation;
        let score = a2 * clamped_safe;
        scores[i] = score;
        denom += score;
    }

    denom
}

/// Core elastic error distribution algorithm.
///
/// Three-pass algorithm:
/// 1. Primary: activation² × safeZoneFactor scoring (SIMD-accelerated)
/// 2. Fallback: weight² scoring when activations are near zero
/// 3. Last resort: equal split when both activations and weights are zero
///
/// Returns a Vec<f32> of error shares whose sum equals `error`.
#[inline(always)]
pub fn apply_distribute_elastic_error(
    error: f32,
    activations: &[f32],
    safe_zone_factors: &[f32],
    weights: &[f32],
    plank_constant: f32,
) -> Vec<f32> {
    let count = activations.len();

    if !error.is_finite() || count == 0 {
        return vec![0.0; count];
    }

    // Pass 1: Score calculation with SIMD
    let mut scores = vec![0.0f32; count];
    let denom = score_pass_simd(activations, safe_zone_factors, &mut scores);

    if denom <= plank_constant {
        // Pass 2: Weight-based fallback (weight²)
        let mut weight_denom: f32 = 0.0;
        let mut weight_scores = vec![0.0f32; count];

        for i in 0..count {
            let w = weights[i];
            let w2 = if w.is_finite() { w * w } else { 0.0 };
            weight_scores[i] = w2;
            weight_denom += w2;
        }

        if weight_denom > plank_constant {
            let mut shares = vec![0.0f32; count];
            let mut sum: f32 = 0.0;

            for i in 0..count {
                let share = error * (weight_scores[i] / weight_denom);
                shares[i] = share;
                sum += share;
            }

            // Floating-point residue redistribution
            let residue = error - sum;
            if residue.abs() > plank_constant {
                let mut best_idx: usize = 0;
                for i in 1..count {
                    if weight_scores[i] > weight_scores[best_idx] {
                        best_idx = i;
                    }
                }
                shares[best_idx] += residue;
            }

            return shares;
        }

        // Pass 3: Equal split (last resort)
        let per = error / (count as f32);
        return vec![per; count];
    }

    // Distribute proportionally to scores
    let mut shares = vec![0.0f32; count];
    let mut sum: f32 = 0.0;
    let mut best_idx: usize = 0;
    let mut best_score: f32 = -f32::INFINITY;

    for i in 0..count {
        let share = error * (scores[i] / denom);
        shares[i] = share;
        sum += share;
        if scores[i] > best_score {
            best_score = scores[i];
            best_idx = i;
        }
    }

    // Floating-point residue redistribution
    let residue = error - sum;
    if residue.abs() > plank_constant {
        shares[best_idx] += residue;
    }

    shares
}

/// Issue #1519 - WASM-exported standalone elastic error distribution.
///
/// Distributes `error` across links proportional to activation² × safeZoneFactor,
/// with weight-based fallback when activations are near zero, and equal split
/// as a last resort.
///
/// # Arguments
/// * `error` - The error value to distribute
/// * `activations` - Float32Array of link activation values
/// * `safe_zone_factors` - Float32Array of safe zone factors (0-1)
/// * `weights` - Float32Array of synapse weights (for fallback)
/// * `plank_constant` - Threshold for floating-point comparisons
///
/// # Returns
/// Vec<f32> of error shares, one per link. Sum equals `error`.
#[wasm_bindgen]
pub fn distribute_elastic_error(
    error: f32,
    activations: &[f32],
    safe_zone_factors: &[f32],
    weights: &[f32],
    plank_constant: f32,
) -> Vec<f32> {
    apply_distribute_elastic_error(error, activations, safe_zone_factors, weights, plank_constant)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prefers_higher_activation() {
        let shares = apply_distribute_elastic_error(
            10.0,
            &[1.0, 2.0],
            &[1.0, 1.0],
            &[1.0, 1.0],
            PLANK_CONSTANT,
        );
        assert_eq!(shares.len(), 2);
        // activation² weighting: 1²=1, 2²=4
        // share0 = 10 * 1/5 = 2, share1 = 10 * 4/5 = 8
        assert!((shares[0] - 2.0).abs() < 1e-5, "share0={}", shares[0]);
        assert!((shares[1] - 8.0).abs() < 1e-5, "share1={}", shares[1]);
        assert!(
            (shares[0] + shares[1] - 10.0).abs() < 1e-5,
            "sum={}",
            shares[0] + shares[1]
        );
    }

    #[test]
    fn test_honours_safe_zone_factor() {
        // safeZoneFactor=0 should block a link
        let shares = apply_distribute_elastic_error(
            10.0,
            &[1.0, 1.0],
            &[1.0, 0.0],
            &[1.0, 1.0],
            PLANK_CONSTANT,
        );
        assert!((shares[0] - 10.0).abs() < 1e-5, "share0={}", shares[0]);
        assert!((shares[1]).abs() < 1e-5, "share1={}", shares[1]);
    }

    #[test]
    fn test_weight_fallback_prefers_larger_weights() {
        // All activations zero → weight-based fallback
        let shares = apply_distribute_elastic_error(
            12.0,
            &[0.0, 0.0, 0.0],
            &[1.0, 1.0, 1.0],
            &[1.0, 2.0, 3.0],
            PLANK_CONSTANT,
        );
        assert_eq!(shares.len(), 3);
        // weight²: 1, 4, 9 → denom = 14
        let expected0 = 12.0 * (1.0 / 14.0);
        let expected1 = 12.0 * (4.0 / 14.0);
        let expected2 = 12.0 * (9.0 / 14.0);
        assert!(
            (shares[0] - expected0).abs() < 1e-4,
            "share0={}, expected={}",
            shares[0],
            expected0
        );
        assert!(
            (shares[1] - expected1).abs() < 1e-4,
            "share1={}, expected={}",
            shares[1],
            expected1
        );
        assert!(
            (shares[2] - expected2).abs() < 1e-4,
            "share2={}, expected={}",
            shares[2],
            expected2
        );
    }

    #[test]
    fn test_equal_split_last_resort() {
        // Both activations and weights are zero
        let shares = apply_distribute_elastic_error(
            9.0,
            &[0.0, 0.0, 0.0],
            &[1.0, 1.0, 1.0],
            &[0.0, 0.0, 0.0],
            PLANK_CONSTANT,
        );
        assert_eq!(shares.len(), 3);
        for &s in &shares {
            assert!((s - 3.0).abs() < 1e-5, "share={}", s);
        }
    }

    #[test]
    fn test_nan_error_returns_zeros() {
        let shares = apply_distribute_elastic_error(
            f32::NAN,
            &[1.0, 2.0],
            &[1.0, 1.0],
            &[1.0, 1.0],
            PLANK_CONSTANT,
        );
        assert_eq!(shares.len(), 2);
        for &s in &shares {
            assert_eq!(s, 0.0);
        }
    }

    #[test]
    fn test_infinite_error_returns_zeros() {
        let shares = apply_distribute_elastic_error(
            f32::INFINITY,
            &[1.0],
            &[1.0],
            &[1.0],
            PLANK_CONSTANT,
        );
        assert_eq!(shares.len(), 1);
        assert_eq!(shares[0], 0.0);
    }

    #[test]
    fn test_empty_links() {
        let shares = apply_distribute_elastic_error(
            10.0,
            &[],
            &[],
            &[],
            PLANK_CONSTANT,
        );
        assert!(shares.is_empty());
    }

    #[test]
    fn test_single_link() {
        let shares = apply_distribute_elastic_error(
            5.0,
            &[3.0],
            &[1.0],
            &[1.0],
            PLANK_CONSTANT,
        );
        assert_eq!(shares.len(), 1);
        assert!((shares[0] - 5.0).abs() < 1e-5, "share={}", shares[0]);
    }

    #[test]
    fn test_negative_error() {
        let shares = apply_distribute_elastic_error(
            -6.0,
            &[1.0, 2.0],
            &[1.0, 1.0],
            &[1.0, 1.0],
            PLANK_CONSTANT,
        );
        // 1²=1, 2²=4, denom=5
        assert!(
            (shares[0] - (-6.0 * 1.0 / 5.0)).abs() < 1e-5,
            "share0={}",
            shares[0]
        );
        assert!(
            (shares[1] - (-6.0 * 4.0 / 5.0)).abs() < 1e-5,
            "share1={}",
            shares[1]
        );
    }

    #[test]
    fn test_zero_error() {
        let shares = apply_distribute_elastic_error(
            0.0,
            &[1.0, 2.0],
            &[1.0, 1.0],
            &[1.0, 1.0],
            PLANK_CONSTANT,
        );
        for &s in &shares {
            assert_eq!(s, 0.0);
        }
    }

    #[test]
    fn test_nan_activation_treated_as_zero() {
        let shares = apply_distribute_elastic_error(
            10.0,
            &[f32::NAN, 2.0],
            &[1.0, 1.0],
            &[1.0, 1.0],
            PLANK_CONSTANT,
        );
        // NaN activation → score = 0, so all error goes to link 1
        assert!((shares[0]).abs() < 1e-5, "share0={}", shares[0]);
        assert!((shares[1] - 10.0).abs() < 1e-5, "share1={}", shares[1]);
    }

    #[test]
    fn test_safe_zone_clamped() {
        // safeZoneFactor > 1 should be clamped to 1
        let shares_clamped = apply_distribute_elastic_error(
            10.0,
            &[1.0, 1.0],
            &[2.0, 2.0],
            &[1.0, 1.0],
            PLANK_CONSTANT,
        );
        let shares_normal = apply_distribute_elastic_error(
            10.0,
            &[1.0, 1.0],
            &[1.0, 1.0],
            &[1.0, 1.0],
            PLANK_CONSTANT,
        );
        for i in 0..2 {
            assert!(
                (shares_clamped[i] - shares_normal[i]).abs() < 1e-5,
                "clamped[{}]={}, normal[{}]={}",
                i,
                shares_clamped[i],
                i,
                shares_normal[i]
            );
        }
    }

    #[test]
    fn test_error_conservation_many_links() {
        let count = 50;
        let activations: Vec<f32> = (0..count).map(|i| (i as f32 * 0.7).sin()).collect();
        let safe_zones: Vec<f32> = (0..count).map(|i| ((i as f32 * 0.3).cos() + 1.0) / 2.0).collect();
        let weights: Vec<f32> = (0..count).map(|i| (i as f32 * 0.5).sin()).collect();
        let error = 42.0;

        let shares = apply_distribute_elastic_error(
            error,
            &activations,
            &safe_zones,
            &weights,
            PLANK_CONSTANT,
        );

        let sum: f32 = shares.iter().sum();
        assert!(
            (sum - error).abs() < 1e-3,
            "sum={}, error={}",
            sum,
            error
        );
    }

    #[test]
    fn test_weight_fallback_negative_weights() {
        // Negative weights should use absolute value squared
        let shares = apply_distribute_elastic_error(
            10.0,
            &[0.0, 0.0],
            &[1.0, 1.0],
            &[-3.0, 3.0],
            PLANK_CONSTANT,
        );
        // Both |w|²=9, so equal split
        assert!(
            (shares[0] - 5.0).abs() < 1e-5,
            "share0={}",
            shares[0]
        );
        assert!(
            (shares[1] - 5.0).abs() < 1e-5,
            "share1={}",
            shares[1]
        );
    }

    #[test]
    fn test_weight_fallback_nan_weight() {
        // NaN weight → weight score = 0
        let shares = apply_distribute_elastic_error(
            10.0,
            &[0.0, 0.0],
            &[1.0, 1.0],
            &[f32::NAN, 2.0],
            PLANK_CONSTANT,
        );
        // Only link 1 has weight score (4), so it gets all
        assert!((shares[0]).abs() < 1e-5, "share0={}", shares[0]);
        assert!(
            (shares[1] - 10.0).abs() < 1e-5,
            "share1={}",
            shares[1]
        );
    }
}

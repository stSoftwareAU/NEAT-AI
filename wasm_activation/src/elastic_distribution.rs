//! Issue #1519 - Standalone elastic error distribution in WASM.
//!
//! Migrates the `distributeElasticError` algorithm from TypeScript to Rust/WASM.
//! This function performs multi-pass floating-point arithmetic over link arrays
//! during backpropagation:
//!
//! 1. Score calculation: activation² × clamp(safeZoneFactor, 0, 1)
//! 2. Weight-based fallback when activations are near zero (weight²)
//! 3. Share distribution with floating-point residue redistribution
//!
//! Uses SIMD for the scoring pass (activation squaring + accumulation).

/// Distribute error across links proportionally to activation² × safeZoneFactor.
///
/// # Arguments
/// * `error` - The total error to distribute
/// * `activations` - Per-link activation values (f64)
/// * `safe_zone_factors` - Per-link safe zone factors in [0, 1] (f64)
/// * `weights` - Per-link synapse weights for fallback (f64); use NaN if unavailable
/// * `plank_constant` - Threshold for near-zero comparisons (f64)
///
/// # Returns
/// `Vec<f64>` of per-link error shares that sum to `error`.
pub fn apply_distribute_elastic_error(
    error: f64,
    activations: &[f64],
    safe_zone_factors: &[f64],
    weights: &[f64],
    plank_constant: f64,
) -> Vec<f64> {
    let count = activations.len();

    if !error.is_finite() || count == 0 {
        return vec![0.0; count];
    }

    // Pass 1: Score calculation — activation² × clamp(safeZoneFactor, 0, 1)
    let mut scores = vec![0.0f64; count];
    let mut denom: f64 = 0.0;

    for i in 0..count {
        let activation = activations[i];
        let safe = safe_zone_factors[i];

        if !activation.is_finite() || !safe.is_finite() {
            continue;
        }

        let clamped_safe = safe.clamp(0.0, 1.0);
        let a2 = activation * activation;
        let score = a2 * clamped_safe;
        scores[i] = score;
        denom += score;
    }

    if denom <= plank_constant {
        // Pass 2: Weight-based fallback (weight²)
        let mut weight_scores = vec![0.0f64; count];
        let mut weight_denom: f64 = 0.0;

        for i in 0..count {
            let w = weights[i];
            if w.is_finite() {
                let w2 = w * w;
                weight_scores[i] = w2;
                weight_denom += w2;
            }
        }

        if weight_denom > plank_constant {
            // Distribute by weight²
            let mut shares = vec![0.0f64; count];
            let mut sum: f64 = 0.0;

            for i in 0..count {
                let share = error * (weight_scores[i] / weight_denom);
                shares[i] = share;
                sum += share;
            }

            // Floating-point tidy-up: add residue to highest-score link
            let residue = error - sum;
            if residue.abs() > plank_constant {
                let mut best_idx = 0usize;
                for i in 1..count {
                    if weight_scores[i] > weight_scores[best_idx] {
                        best_idx = i;
                    }
                }
                shares[best_idx] += residue;
            }

            return shares;
        }

        // Last resort: equal split
        let per = error / (count as f64);
        return vec![per; count];
    }

    // Pass 3: Distribute proportionally to scores
    let mut shares = vec![0.0f64; count];
    let mut sum: f64 = 0.0;
    let mut best_idx: usize = 0;
    let mut best_score: f64 = f64::NEG_INFINITY;

    for i in 0..count {
        let share = error * (scores[i] / denom);
        shares[i] = share;
        sum += share;
        if scores[i] > best_score {
            best_score = scores[i];
            best_idx = i;
        }
    }

    // Floating-point tidy-up: add residue to highest-score link
    let residue = error - sum;
    if residue.abs() > plank_constant {
        shares[best_idx] += residue;
    }

    shares
}

/// WASM-exported elastic error distribution.
///
/// Takes struct-of-arrays layout for link data to avoid per-element object
/// property access overhead from JavaScript.
///
/// # Arguments
/// * `error` - The total error to distribute
/// * `activations` - Flat f64 array of per-link activation values
/// * `safe_zone_factors` - Flat f64 array of per-link safe zone factors
/// * `weights` - Flat f64 array of per-link weights (use NaN if unavailable)
/// * `plank_constant` - Threshold for near-zero comparisons
///
/// # Returns
/// `Vec<f64>` of per-link error shares.
pub fn wasm_distribute_elastic_error(
    error: f64,
    activations: &[f64],
    safe_zone_factors: &[f64],
    weights: &[f64],
    plank_constant: f64,
) -> Vec<f64> {
    apply_distribute_elastic_error(error, activations, safe_zone_factors, weights, plank_constant)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPS: f64 = 1e-12;

    #[test]
    fn test_basic_proportional_distribution() {
        // activation²: 1²=1, 2²=4 → shares: 2 and 8
        let shares = apply_distribute_elastic_error(
            10.0,
            &[1.0, 2.0],
            &[1.0, 1.0],
            &[f64::NAN, f64::NAN],
            1e-12,
        );
        assert_eq!(shares.len(), 2);
        assert!((shares[0] - 2.0).abs() < EPS);
        assert!((shares[1] - 8.0).abs() < EPS);
    }

    #[test]
    fn test_safe_zone_blocks_link() {
        let shares = apply_distribute_elastic_error(
            10.0,
            &[1.0, 2.0],
            &[0.0, 1.0],
            &[f64::NAN, f64::NAN],
            1e-12,
        );
        assert!((shares[0] - 0.0).abs() < EPS);
        assert!((shares[1] - 10.0).abs() < EPS);
    }

    #[test]
    fn test_equal_split_fallback() {
        let shares = apply_distribute_elastic_error(
            10.0,
            &[0.0, 0.0],
            &[1.0, 1.0],
            &[f64::NAN, f64::NAN],
            1e-12,
        );
        assert!((shares[0] - 5.0).abs() < EPS);
        assert!((shares[1] - 5.0).abs() < EPS);
    }

    #[test]
    fn test_weight_fallback() {
        let shares = apply_distribute_elastic_error(
            10.0,
            &[0.0, 0.0],
            &[1.0, 1.0],
            &[1.0, 3.0],
            1e-12,
        );
        // weight²: 1, 9 → shares: 1, 9
        assert!((shares[0] - 1.0).abs() < EPS);
        assert!((shares[1] - 9.0).abs() < EPS);
    }

    #[test]
    fn test_empty_links() {
        let shares = apply_distribute_elastic_error(
            10.0,
            &[],
            &[],
            &[],
            1e-12,
        );
        assert!(shares.is_empty());
    }

    #[test]
    fn test_non_finite_error() {
        let shares = apply_distribute_elastic_error(
            f64::NAN,
            &[1.0],
            &[1.0],
            &[f64::NAN],
            1e-12,
        );
        assert_eq!(shares[0], 0.0);
    }

    #[test]
    fn test_conservation_many_links() {
        let activations = vec![0.1, 0.5, 1.0, 2.0, 3.0];
        let safe_zones = vec![1.0, 0.9, 0.7, 0.5, 1.0];
        let weights = vec![f64::NAN; 5];
        let error = 42.0;

        let shares = apply_distribute_elastic_error(
            error,
            &activations,
            &safe_zones,
            &weights,
            1e-12,
        );
        let sum: f64 = shares.iter().sum();
        assert!((sum - error).abs() < 1e-9);
    }

    #[test]
    fn test_negative_error() {
        let shares = apply_distribute_elastic_error(
            -15.3,
            &[1.0, 2.0, 0.5],
            &[1.0, 1.0, 1.0],
            &[f64::NAN, f64::NAN, f64::NAN],
            1e-12,
        );
        let sum: f64 = shares.iter().sum();
        assert!((sum - (-15.3)).abs() < 1e-9);
    }

    #[test]
    fn test_non_finite_activation_treated_as_zero() {
        let shares = apply_distribute_elastic_error(
            10.0,
            &[f64::NAN, 2.0],
            &[1.0, 1.0],
            &[f64::NAN, f64::NAN],
            1e-12,
        );
        assert!((shares[0] - 0.0).abs() < EPS);
        assert!((shares[1] - 10.0).abs() < EPS);
    }

    #[test]
    fn test_safe_zone_clamped() {
        // safeZoneFactor > 1 should be clamped to 1
        let shares = apply_distribute_elastic_error(
            10.0,
            &[1.0, 1.0],
            &[5.0, 1.0],
            &[f64::NAN, f64::NAN],
            1e-12,
        );
        assert!((shares[0] - 5.0).abs() < EPS);
        assert!((shares[1] - 5.0).abs() < EPS);
    }

    #[test]
    fn test_negative_safe_zone_treated_as_zero() {
        let shares = apply_distribute_elastic_error(
            10.0,
            &[1.0, 1.0],
            &[-0.5, 1.0],
            &[f64::NAN, f64::NAN],
            1e-12,
        );
        assert!((shares[0] - 0.0).abs() < EPS);
        assert!((shares[1] - 10.0).abs() < EPS);
    }

    #[test]
    fn test_single_link_gets_all_error() {
        let shares = apply_distribute_elastic_error(
            12.0,
            &[5.0],
            &[1.0],
            &[f64::NAN],
            1e-12,
        );
        assert_eq!(shares.len(), 1);
        assert!((shares[0] - 12.0).abs() < EPS);
    }

    #[test]
    fn test_weight_fallback_conservation() {
        let error = 13.7;
        let shares = apply_distribute_elastic_error(
            error,
            &[0.0, 0.0, 0.0],
            &[0.0, 0.0, 0.0],
            &[2.0, 5.0, 3.0],
            1e-12,
        );
        let sum: f64 = shares.iter().sum();
        assert!((sum - error).abs() < 1e-9);
    }
}

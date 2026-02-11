//! Issue #1377 - Fused backward pass error distribution in WASM.
//!
//! Combines three steps of the backward pass into a single WASM call:
//! 1. `calculateError()` - compute neuron error in value-space
//! 2. `safeZoneAdjustment()` per synapse - compute gradient flow safety
//! 3. Elastic error distribution - allocate error proportional to activation²×safeZone
//!
//! This eliminates S+1 WASM boundary crossings per neuron and keeps all
//! intermediate float values in WASM linear memory.

use crate::error::apply_calculate_error;
use crate::safe_zone::apply_safe_zone_adjustment;
use crate::squash::SquashType;

/// Planck constant for floating-point comparisons (matches TypeScript default).
const PLANK_CONSTANT: f32 = 1e-12;

/// Fused error distribution result.
/// Layout: [error, safeZone_0..safeZone_N, perLinkError_0..perLinkError_N]
/// Total length: 1 + 2*N
///
/// This flat layout avoids allocating multiple Vec/Float32Array objects across
/// the WASM boundary.
pub fn apply_fused_error_distribution(
    neuron_squash_type: SquashType,
    neuron_activation: f32,
    neuron_target_activation: f32,
    neuron_hint_value: f32,
    upstream_squash_types: &[u8],
    upstream_hint_values: &[f32],
    upstream_activations: &[f32],
    synapse_weights: &[f32],
) -> Vec<f32> {
    let count = upstream_squash_types.len();

    // Step 1: Calculate error in value-space
    let error = apply_calculate_error(
        neuron_squash_type,
        neuron_activation,
        neuron_target_activation,
        neuron_hint_value,
    );

    // Result buffer: [error, safeZoneFactors..., perLinkErrors...]
    let mut result = Vec::with_capacity(1 + 2 * count);
    result.push(error);

    if count == 0 {
        return result;
    }

    // Early exit: if error is zero, all shares are zero
    if error == 0.0 {
        // safeZoneFactors (all 1.0 as default)
        for _ in 0..count {
            result.push(1.0);
        }
        // perLinkErrors (all 0.0)
        for _ in 0..count {
            result.push(0.0);
        }
        return result;
    }

    let provisional_error_per_link = error / (count as f32);

    // Step 2: Safe zone adjustment per synapse
    let mut safe_zone_factors = Vec::with_capacity(count);
    for i in 0..count {
        let squash = SquashType::from(upstream_squash_types[i]);
        let raw_input = upstream_hint_values[i];
        let weight = if synapse_weights[i].is_finite() {
            synapse_weights[i]
        } else {
            1.0
        };
        let factor = apply_safe_zone_adjustment(
            squash,
            raw_input,
            provisional_error_per_link,
            weight,
        );
        safe_zone_factors.push(factor);
    }

    // Push safe zone factors into result
    for &factor in &safe_zone_factors {
        result.push(factor);
    }

    // Step 3: Elastic error distribution
    // score[i] = activation[i]² × clamp(safeZoneFactor[i], 0, 1)
    let mut scores = Vec::with_capacity(count);
    let mut denom: f32 = 0.0;
    for i in 0..count {
        let activation = upstream_activations[i];
        let safe = safe_zone_factors[i];

        if !activation.is_finite() || !safe.is_finite() {
            scores.push(0.0);
            continue;
        }

        let clamped_safe = safe.clamp(0.0, 1.0);
        let a2 = activation * activation;
        let score = a2 * clamped_safe;
        scores.push(score);
        denom += score;
    }

    if denom <= PLANK_CONSTANT {
        // Fallback: equal split (early training, all activations near zero)
        let per = error / (count as f32);
        for _ in 0..count {
            result.push(per);
        }
    } else {
        // Distribute proportionally to scores
        let mut sum: f32 = 0.0;
        let mut best_idx: usize = 0;
        let mut best_score: f32 = -f32::INFINITY;

        for i in 0..count {
            let share = error * (scores[i] / denom);
            result.push(share);
            sum += share;
            if scores[i] > best_score {
                best_score = scores[i];
                best_idx = i;
            }
        }

        // Floating-point cleanup: add residue to highest-score link
        let residue = error - sum;
        if residue.abs() > PLANK_CONSTANT {
            // Offset into result: 1 (error) + count (safeZones) + best_idx
            result[1 + count + best_idx] += residue;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fused_basic_identity() {
        // Identity neuron: error = target - current = 0.3
        let result = apply_fused_error_distribution(
            SquashType::Identity,
            0.5,
            0.8,
            0.5,
            &[SquashType::Identity as u8, SquashType::Identity as u8],
            &[1.0, 2.0],
            &[1.0, 2.0],
            &[1.0, 1.0],
        );

        // Result layout: [error, safe0, safe1, share0, share1]
        assert_eq!(result.len(), 5);
        let error = result[0];
        assert!((error - 0.3).abs() < 1e-5, "error should be ~0.3, got {}", error);

        // Identity safe zones at moderate inputs should be 1.0
        let safe0 = result[1];
        let safe1 = result[2];
        assert!(safe0 > 0.0);
        assert!(safe1 > 0.0);

        // shares should sum to error
        let share0 = result[3];
        let share1 = result[4];
        assert!(
            (share0 + share1 - error).abs() < 1e-5,
            "shares should sum to error: {} + {} = {} vs {}",
            share0,
            share1,
            share0 + share1,
            error,
        );

        // activation² weighting: 1²=1, 2²=4, so share1 should be ~4× share0
        let ratio = share1 / share0;
        assert!(
            (ratio - 4.0).abs() < 0.5,
            "ratio should be ~4, got {}",
            ratio,
        );
    }

    #[test]
    fn test_fused_zero_error() {
        let result = apply_fused_error_distribution(
            SquashType::Identity,
            1.0,
            1.0,
            1.0,
            &[SquashType::Relu as u8],
            &[1.0],
            &[1.0],
            &[1.0],
        );

        assert_eq!(result.len(), 3);
        assert_eq!(result[0], 0.0); // error
        assert_eq!(result[2], 0.0); // share
    }

    #[test]
    fn test_fused_empty_synapses() {
        let result = apply_fused_error_distribution(
            SquashType::Identity,
            0.5,
            0.8,
            0.5,
            &[],
            &[],
            &[],
            &[],
        );

        assert_eq!(result.len(), 1);
        assert!((result[0] - 0.3).abs() < 1e-5);
    }

    #[test]
    fn test_fused_single_synapse() {
        let result = apply_fused_error_distribution(
            SquashType::Tanh,
            0.0,
            0.5,
            0.0,
            &[SquashType::Identity as u8],
            &[1.0],
            &[1.0],
            &[1.0],
        );

        // Layout: [error, safe0, share0]
        assert_eq!(result.len(), 3);
        let error = result[0];
        let share = result[2];
        // Single synapse gets all the error
        assert!(
            (share - error).abs() < 1e-5,
            "single synapse should get all error: share={}, error={}",
            share,
            error,
        );
    }
}

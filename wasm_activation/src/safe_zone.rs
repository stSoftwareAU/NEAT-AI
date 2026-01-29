//! Safe zone adjustment for backpropagation through activation functions.
//!
//! This module determines how useful it is to backpropagate through a neuron
//! based on saturation levels. Issue #1140 - WASM Migration Phase 8.

use crate::squash::SquashType;

/// Apply safe zone adjustment for a given activation function
/// Issue #1140 - WASM Migration Phase 8: Implement safeZoneAdjustment() in Rust/WASM
///
/// Returns a float from 0 (not safe) to 1 (fully safe) indicating how useful it is
/// to backpropagate through a neuron based on saturation levels.
///
/// - 1.0: Fully in safe zone, gradient flows freely
/// - 0.0: Completely saturated, no gradient should flow
/// - 0.0-1.0: Partial safety, used for gradual fade-out
///
/// # Arguments
/// * `squash_type` - The type of activation function
/// * `raw_input` - The raw input value before squashing
/// * `error` - The error value from backpropagation
/// * `weight` - The synapse weight (used by some activation functions)
#[inline(always)]
pub fn apply_safe_zone_adjustment(
    squash_type: SquashType,
    raw_input: f32,
    error: f32,
    weight: f32,
) -> f32 {
    // Non-finite inputs are never safe
    if !raw_input.is_finite() {
        return 0.0;
    }

    match squash_type {
        // IDENTITY: Almost never saturates, but checks for extreme raw inputs with tiny weights
        SquashType::Identity => {
            let abs_raw = raw_input.abs();
            let abs_weight = weight.abs();

            let raw_is_extreme = abs_raw > 1e6;
            let weight_too_small = abs_weight < 1e-6;

            if raw_is_extreme && weight_too_small {
                return 0.0; // suggest adjusting the weight instead
            }

            1.0
        }

        // ReLU: Dead ReLU problem - only safe when positive or recovering
        SquashType::Relu => {
            if raw_input > 0.0 {
                return 1.0; // Fully active
            }

            // Recovery: try to push back into positive zone
            if raw_input <= 0.0 && error > 0.0 {
                return 1.0;
            }

            // Dead and shouldn't wake up
            0.0
        }

        // ReLU6: Both ends saturate
        SquashType::Relu6 => {
            if raw_input > 0.0 && raw_input < 6.0 {
                return 1.0;
            }

            if raw_input <= 0.0 && error > 0.0 {
                return 1.0; // Try to reactivate
            }

            if raw_input >= 6.0 && error < 0.0 {
                return 1.0; // Try to lower from saturated high
            }

            0.0
        }

        // LeakyReLU: Never fully saturates, but has weight-based logic
        SquashType::LeakyRelu => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -50.0;
            let safe_max = 50.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse {
                return 0.0;
            }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 20.0 {
                return 1.0 - (raw_input - safe_max) / 20.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 20.0 {
                return 1.0 - (safe_min - raw_input) / 20.0;
            }

            0.0
        }

        // SELU: Similar to ELU but with specific safe zones
        SquashType::Selu => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse {
                return 0.0;
            }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // ELU: Similar pattern to SELU
        SquashType::Elu => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse {
                return 0.0;
            }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // LOGISTIC (Sigmoid): Classic sigmoid saturation
        SquashType::Logistic => {
            let safe_low = -6.0;
            let safe_high = 6.0;
            let min = -10.0;
            let max = 10.0;

            // Fully safe zone
            if raw_input >= safe_low && raw_input <= safe_high {
                return 1.0;
            }

            // Recovery logic: if we're out of zone, but error would push us back in
            if raw_input < safe_low && error > 0.0 {
                return 0.2; // Pushes rawInput toward centre
            }
            if raw_input > safe_high && error < 0.0 {
                return 0.2;
            }

            // Fading out logic: scale linearly from edge of safe zone to extreme
            if raw_input > safe_high && raw_input <= max {
                return 1.0 - (raw_input - safe_high) / (max - safe_high); // fade from 1 to 0
            }
            if raw_input < safe_low && raw_input >= min {
                return (raw_input - min) / (safe_low - min); // fade from 0 to 1
            }

            // Beyond hard saturation
            0.0
        }

        // TANH: Similar to logistic
        SquashType::Tanh => {
            let safe_low = -2.0;
            let safe_high = 2.0;
            let min = -6.0;
            let max = 6.0;

            // Fully in safe zone
            if raw_input >= safe_low && raw_input <= safe_high {
                return 1.0;
            }

            // Recovery direction logic
            if raw_input < safe_low && error > 0.0 {
                return 0.2;
            }
            if raw_input > safe_high && error < 0.0 {
                return 0.2;
            }

            // Gradual fade to saturation
            if raw_input > safe_high && raw_input <= max {
                return 1.0 - (raw_input - safe_high) / (max - safe_high);
            }
            if raw_input < safe_low && raw_input >= min {
                return (raw_input - min) / (safe_low - min);
            }

            0.0
        }

        // HardTanh: Hard boundaries at -1 and 1
        SquashType::HardTanh => {
            let safe_low = -0.9;
            let safe_high = 0.9;
            let min = -1.2;
            let max = 1.2;

            // Fully safe region
            if raw_input >= safe_low && raw_input <= safe_high {
                return 1.0;
            }

            // Recovery: out of bounds but error would bring it back
            if raw_input <= -1.0 && error > 0.0 {
                return 0.2;
            }
            if raw_input >= 1.0 && error < 0.0 {
                return 0.2;
            }

            // Fade into the dead zone
            if raw_input > safe_high && raw_input <= max {
                return 1.0 - (raw_input - safe_high) / (max - safe_high);
            }
            if raw_input < safe_low && raw_input >= min {
                return (raw_input - min) / (safe_low - min);
            }

            0.0
        }

        // Softsign: Slow saturation
        SquashType::Softsign => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse {
                return 0.0;
            }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range {
                return 1.0;
            }

            // Soft fade near edge zones
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Softplus: One-sided saturation
        SquashType::Softplus => {
            let safe_min = -10.0;
            let safe_max = 20.0;
            let in_safe_raw = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;
            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improves = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_raw && raw_getting_worse {
                return 0.0;
            }
            if in_safe_raw && (weight_too_small || weight_too_large) && weight_improves {
                return 0.0;
            }

            if in_safe_raw {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Swish: Similar to tanh in behaviour
        SquashType::Swish => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse {
                return 0.0;
            }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Mish: Similar to Swish
        SquashType::Mish => {
            let safe_min = -10.0;
            let safe_max = 10.0;
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let in_safe_raw = raw_input >= safe_min && raw_input <= safe_max;
            let raw_worsening =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_raw && raw_worsening {
                return 0.0;
            }
            if in_safe_raw && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_raw {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // GELU: Similar to ReLU but smoother
        SquashType::Gelu => {
            let safe_min = -6.0;
            let safe_max = 6.0;
            let in_safe_raw = raw_input >= safe_min && raw_input <= safe_max;
            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;
            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improves = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_raw && raw_getting_worse {
                return 0.0;
            }
            if in_safe_raw && (weight_too_small || weight_too_large) && weight_improves {
                return 0.0;
            }

            if in_safe_raw {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // SINE: Periodic, always varying
        SquashType::Sine => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let slope = raw_input.cos(); // derivative of sin(x)
            let in_flat_zone = slope.abs() < 0.1;
            let raw_getting_worse = slope * error < 0.0;

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if in_flat_zone && raw_getting_worse {
                return 0.0;
            }
            if !in_flat_zone && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if !in_flat_zone {
                return 1.0;
            }

            // Soft fade for near-flat slope areas
            let fade = slope.abs() / 0.1;
            fade.clamp(0.0, 1.0)
        }

        // Cosine: Periodic
        SquashType::Cosine => {
            let slope = raw_input.sin().abs();
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            // When slope is strong
            if slope > 0.1 {
                if (abs_weight < min_weight && weight * error > 0.0)
                    || (abs_weight > max_weight && weight * error < 0.0)
                {
                    return 0.0; // allow weight to correct first
                }
                return 1.0;
            }

            // Fade zone
            if slope > 0.05 {
                return (slope - 0.05) / 0.05;
            }

            // Flat zone -- poor for learning
            0.0
        }

        // TAN: Avoid asymptotes at +/-pi/2
        SquashType::Tan => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let pi = std::f32::consts::PI;
            let modulo = raw_input % pi;
            let dist_from_asymptote = (modulo.abs() - pi / 2.0).abs();

            let near_asymptote = dist_from_asymptote < 0.2;
            let raw_getting_worse =
                (modulo > pi / 2.0 && error > 0.0) || (modulo < -pi / 2.0 && error < 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if near_asymptote && raw_getting_worse {
                return 0.0;
            }
            if !near_asymptote && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            // Soft fade if near pi/2 mod
            if dist_from_asymptote < 0.5 {
                return 1.0 - (0.5 - dist_from_asymptote) * 2.0;
            }

            1.0
        }

        // ArcTan: Fade at extremes
        SquashType::ArcTan => {
            let abs = raw_input.abs();

            // Ideal gradient zone: roughly x in [-2, 2]
            if abs <= 2.0 {
                return 1.0;
            }

            // Out of bounds: too flat for meaningful updates.
            if abs > 4.0 {
                return 0.0;
            }

            // Recovery zone: allow updates that move toward centre
            if raw_input > 2.0 && error < 0.0 {
                return 0.3;
            }
            if raw_input < -2.0 && error > 0.0 {
                return 0.3;
            }

            // Fade zone: x in [2, 4]
            if abs <= 4.0 {
                return 1.0 - (abs - 2.0) / 2.0;
            }
            0.0
        }

        // GAUSSIAN: Bell curve
        SquashType::Gaussian => {
            let abs_raw = raw_input.abs();
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let in_safe_zone = abs_raw <= 3.0;

            let raw_getting_worse =
                (raw_input < -3.0 && error < 0.0) || (raw_input > 3.0 && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_zone && raw_getting_worse {
                return 0.0;
            }
            if in_safe_zone && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_zone {
                return 1.0;
            }
            if abs_raw <= 6.0 {
                return 1.0 - (abs_raw - 3.0) / 3.0;
            }

            0.0
        }

        // BentIdentity: Never saturates
        SquashType::BentIdentity => {
            let abs = raw_input.abs();

            // Safe/strong zone: x in [-10, 10] is nearly linear
            if abs <= 10.0 {
                return 1.0;
            }

            // Allow recovery if error is pulling us back toward centre
            if raw_input > 10.0 && error < 0.0 {
                return 0.3;
            }
            if raw_input < -10.0 && error > 0.0 {
                return 0.3;
            }

            // Fade between 10 and 20
            if abs <= 20.0 {
                return 1.0 - (abs - 10.0) / 10.0;
            }

            0.0
        }

        // BipolarSigmoid: Similar to logistic
        SquashType::BipolarSigmoid => {
            let abs_raw = raw_input.abs();
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let raw_getting_worse =
                (raw_input < -4.0 && error < 0.0) || (raw_input > 4.0 && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !(-4.0..=4.0).contains(&raw_input) && raw_getting_worse {
                return 0.0;
            }

            if (-4.0..=4.0).contains(&raw_input) {
                if (weight_too_small || weight_too_large) && weight_improving {
                    return 0.0;
                }
                return 1.0;
            }

            // Gradual fade out for raw inputs in [4, 8] or [-8, -4]
            if abs_raw <= 8.0 {
                return 1.0 - (abs_raw - 4.0) / 4.0;
            }

            0.0
        }

        // BIPOLAR: Discontinuous - always return 0
        SquashType::Bipolar => 0.0,

        // STEP: Special handling for threshold function
        SquashType::Step => {
            // STEP function: threshold at x = 0
            let is_above = raw_input > 0.0;
            let expected_above = error > 0.0;

            // If we're on the wrong side and the error pushes us toward the correct side
            if is_above != expected_above {
                return 1.0;
            }

            // If we're on the correct side, but error is still non-zero, reduce confidence
            0.2
        }

        // COMPLEMENT: Never saturates (linear function)
        SquashType::Complement => 1.0,

        // ABSOLUTE: Loses sign information
        SquashType::Absolute => {
            let abs_input = raw_input.abs();
            let abs_weight = weight.abs();

            let very_large_input = abs_input > 1000.0;
            let tiny_weight = abs_weight < 1e-3;

            if very_large_input && tiny_weight {
                return 0.0;
            } // raw input extreme, but weight could move

            1.0
        }

        // SQUARE: x^2 grows fast
        SquashType::Square => {
            let abs = raw_input.abs();

            // Safe zone: input in [-5, 5]
            if abs <= 5.0 {
                return 1.0;
            }

            // If error direction pushes input toward centre, allow it (recovery zone)
            if raw_input > 5.0 && error < 0.0 {
                return 0.2;
            }
            if raw_input < -5.0 && error > 0.0 {
                return 0.2;
            }

            // Fade between 5 and 10
            if abs <= 10.0 {
                return 1.0 - (abs - 5.0) / 5.0;
            }

            // Beyond 10, input dominates and gradients explode
            0.0
        }

        // Cube: x^3 grows extremely fast
        SquashType::Cube => {
            let abs = raw_input.abs();

            // Safe zone: x in [-5, 5]
            if abs <= 5.0 {
                return 1.0;
            }

            // Recovery: error moves us back in
            if raw_input < -5.0 && error > 0.0 {
                return 0.2;
            }
            if raw_input > 5.0 && error < 0.0 {
                return 0.2;
            }

            // Fade: x in [5, 10]
            if abs <= 10.0 {
                return 1.0 - (abs - 5.0) / 5.0;
            }

            0.0
        }

        // SQRT: Only defined for x >= 0
        SquashType::Sqrt => {
            // SQRT is undefined for x < 0; never propagate toward negatives
            if raw_input < 0.0 && error < 0.0 {
                return 0.0;
            }

            // Strong incentive to stay in a stable gradient zone: x in [0.01, 10]
            if (0.01..=10.0).contains(&raw_input) {
                return 1.0;
            }

            // If we're below safe zone and trying to go up (into domain), allow it
            if raw_input < 0.01 && error > 0.0 {
                return 0.3;
            }

            // Fade zone: x in [10, 20] -- flatter gradients, lower gain
            if raw_input > 10.0 && raw_input <= 20.0 {
                return 1.0 - (raw_input - 10.0) / 10.0;
            }

            // Above 20, gradients are too flat; prefer weight/bias adjustment
            0.0
        }

        // StdInverse: Sensitive around zero
        SquashType::StdInverse => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse {
                return 0.0;
            }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Exponential: Grows rapidly
        SquashType::Exponential => {
            // Safe zone for Exponential raw input
            let safe_min = -10.0;
            let safe_max = 30.0;
            let in_safe_raw = raw_input >= safe_min && raw_input <= safe_max;

            // Check if pushing raw input would make it worse
            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            // Safe weight bounds
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;
            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;

            // Is weight improvement in direction of error?
            let weight_improves = (weight_too_small && weight * error > 0.0)
                || // growing small weight
                (weight_too_large && weight * error < 0.0); // shrinking big weight

            // Fallback to weight adjustment
            if !in_safe_raw && raw_getting_worse {
                return 0.0;
            }
            if in_safe_raw && (weight_too_small || weight_too_large) && weight_improves {
                return 0.0;
            }

            // Default logic (fade outside the soft safe zone)
            if in_safe_raw {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // LogSigmoid: Flattens sharply for large negative inputs
        SquashType::LogSigmoid => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -20.0;
            let safe_max = 20.0;
            let fade_min = -30.0;
            let fade_max = 30.0;

            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;
            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            // Prefer not to propagate if the raw input is very bad and the weight would help
            if !in_safe_range && raw_getting_worse {
                return 0.0;
            }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range {
                return 1.0;
            }

            // Soft fade zones
            if raw_input > safe_max && raw_input <= fade_max {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= fade_min {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // ISRU: Saturates at large |x|
        SquashType::Isru => {
            let abs_weight = weight.abs();
            let min_weight = 1e-3;
            let max_weight = 1e3;

            let safe_min = -10.0;
            let safe_max = 10.0;
            let in_safe_range = raw_input >= safe_min && raw_input <= safe_max;

            let raw_getting_worse =
                (raw_input < safe_min && error < 0.0) || (raw_input > safe_max && error > 0.0);

            let weight_too_small = abs_weight < min_weight;
            let weight_too_large = abs_weight > max_weight;
            let weight_improving = (weight_too_small && weight * error > 0.0)
                || (weight_too_large && weight * error < 0.0);

            if !in_safe_range && raw_getting_worse {
                return 0.0;
            }
            if in_safe_range && (weight_too_small || weight_too_large) && weight_improving {
                return 0.0;
            }

            if in_safe_range {
                return 1.0;
            }
            if raw_input > safe_max && raw_input <= safe_max + 10.0 {
                return 1.0 - (raw_input - safe_max) / 10.0;
            }
            if raw_input < safe_min && raw_input >= safe_min - 10.0 {
                return 1.0 - (safe_min - raw_input) / 10.0;
            }

            0.0
        }

        // Aggregate functions - not differentiable, always return 0
        SquashType::Minimum | SquashType::Maximum | SquashType::If => 0.0,
        SquashType::Hypotenuse | SquashType::HypotenuseV2 | SquashType::Mean => 0.0,
    }
}

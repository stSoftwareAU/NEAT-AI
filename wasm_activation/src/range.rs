//! Range validation for activation function outputs.
//!
//! This module provides functions to get, validate, and limit activation ranges.
//! Issue #1142 - WASM Migration Phase 10.

use crate::squash::{SquashType, SELU_ALPHA, SELU_LAMBDA, SOFTSIGN_LIMIT};

// Special range constants based on TypeScript implementations
// GELU minimum occurs around x approx -0.509 with value approx -0.17
pub const GELU_MIN: f32 = -0.17;

// Swish minimum occurs around x approx -1.278 with value approx -0.278
pub const SWISH_MIN: f32 = -0.278;

// Mish minimum occurs around x approx -1.19 with value approx -0.309
pub const MISH_MIN: f32 = -0.309;

// Softplus practical lower bound (small positive)
pub const SOFTPLUS_MIN: f32 = 1e-15;

// Softplus practical upper bound (prevents overflow)
pub const SOFTPLUS_MAX: f32 = 100.0;

// Use f32::MAX as a practical "unbounded" value since we're in WASM/f32 space
pub const F32_LARGE: f32 = 3.4028235e38;

/// Get the range (low, high) for an activation function
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns a tuple (low, high) representing the valid output range.
#[inline(always)]
pub fn apply_get_range(squash_type: SquashType) -> (f32, f32) {
    match squash_type {
        // Unbounded functions: use large f32 values
        SquashType::Identity => (-F32_LARGE, F32_LARGE),
        SquashType::LeakyRelu => (-F32_LARGE, F32_LARGE),
        SquashType::Tan => (-F32_LARGE, F32_LARGE),
        SquashType::BentIdentity => (-F32_LARGE, F32_LARGE),
        SquashType::Complement => (-F32_LARGE, F32_LARGE),
        SquashType::Cube => (-F32_LARGE, F32_LARGE),
        SquashType::StdInverse => (-F32_LARGE, F32_LARGE),

        // One-sided unbounded [0, inf)
        SquashType::Relu => (0.0, F32_LARGE),
        SquashType::Absolute => (0.0, F32_LARGE),
        SquashType::Square => (0.0, F32_LARGE),
        SquashType::Sqrt => (0.0, F32_LARGE),
        SquashType::Exponential => (0.0, F32_LARGE),

        // Bounded [0, 1]
        SquashType::Logistic => (0.0, 1.0),
        SquashType::Gaussian => (0.0, 1.0),
        SquashType::Step => (0.0, 1.0),

        // Bounded [-1, 1]
        SquashType::Tanh => (-1.0, 1.0),
        SquashType::HardTanh => (-1.0, 1.0),
        SquashType::Sine => (-1.0, 1.0),
        SquashType::Cosine => (-1.0, 1.0),
        SquashType::BipolarSigmoid => (-1.0, 1.0),
        SquashType::Bipolar => (-1.0, 1.0),
        SquashType::Isru => (-1.0, 1.0),

        // Specific bounded ranges
        SquashType::Relu6 => (0.0, 6.0),
        SquashType::Softsign => (-SOFTSIGN_LIMIT, SOFTSIGN_LIMIT),
        SquashType::Softplus => (SOFTPLUS_MIN, SOFTPLUS_MAX),
        SquashType::ArcTan => (-std::f32::consts::FRAC_PI_2, std::f32::consts::FRAC_PI_2),

        // Special bounded with negative lower
        SquashType::Elu => (-1.0, F32_LARGE), // ELU with alpha=1 has min of -1
        SquashType::Selu => (-SELU_ALPHA * SELU_LAMBDA, F32_LARGE), // SELU minimum
        SquashType::LogSigmoid => (-F32_LARGE, 0.0), // Output is always <= 0

        // Functions with empirically determined minimums
        SquashType::Swish => (SWISH_MIN, F32_LARGE),
        SquashType::Mish => (MISH_MIN, F32_LARGE),
        SquashType::Gelu => (GELU_MIN, F32_LARGE),

        // Aggregate functions - unbounded
        SquashType::Minimum => (-F32_LARGE, F32_LARGE),
        SquashType::Maximum => (-F32_LARGE, F32_LARGE),
        SquashType::If => (-F32_LARGE, F32_LARGE),
        SquashType::Hypotenuse => (-F32_LARGE, F32_LARGE),
        SquashType::HypotenuseV2 => (0.0, F32_LARGE), // HYPOTv2 output >= 0
        SquashType::Mean => (-F32_LARGE, F32_LARGE),
    }
}

/// Validate that an activation value is within the valid range
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns true if the activation is within the valid range, false otherwise.
/// Also returns false for NaN and Infinity values.
#[inline(always)]
pub fn apply_validate_range(squash_type: SquashType, activation: f32) -> bool {
    // NaN and Infinity are never valid
    if !activation.is_finite() {
        return false;
    }

    let (low, high) = apply_get_range(squash_type);
    activation >= low && activation <= high
}

/// Clamp a value to the valid range for an activation function
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns the value clamped to the valid range.
/// Infinity values are clamped to the bounds.
/// NaN returns 0.0 as a safe default.
#[inline(always)]
pub fn apply_limit_range(squash_type: SquashType, value: f32) -> f32 {
    // Handle NaN - return 0 as a safe default
    if value.is_nan() {
        return 0.0;
    }

    let (low, high) = apply_get_range(squash_type);

    // Handle infinities by clamping to bounds
    if value == f32::INFINITY {
        return high.min(F32_LARGE);
    }
    if value == f32::NEG_INFINITY {
        return low.max(-F32_LARGE);
    }

    // Clamp to range
    value.max(low).min(high)
}

#[allow(dead_code)]
#[inline(always)]
pub fn apply_limit_range_f64(squash_type: SquashType, value: f64) -> f64 {
    if value.is_nan() {
        return 0.0;
    }

    let (low_f32, high_f32) = apply_get_range(squash_type);
    let low = low_f32 as f64;
    let high = high_f32 as f64;

    if value == f64::INFINITY {
        return high.min(F32_LARGE as f64);
    }
    if value == f64::NEG_INFINITY {
        return low.max(-(F32_LARGE as f64));
    }

    value.max(low).min(high)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_range_bounded() {
        // LOGISTIC [0, 1]
        let (low, high) = apply_get_range(SquashType::Logistic);
        assert_eq!(low, 0.0, "Logistic low should be 0");
        assert_eq!(high, 1.0, "Logistic high should be 1");

        // TANH [-1, 1]
        let (low, high) = apply_get_range(SquashType::Tanh);
        assert_eq!(low, -1.0, "Tanh low should be -1");
        assert_eq!(high, 1.0, "Tanh high should be 1");

        // ReLU6 [0, 6]
        let (low, high) = apply_get_range(SquashType::Relu6);
        assert_eq!(low, 0.0, "ReLU6 low should be 0");
        assert_eq!(high, 6.0, "ReLU6 high should be 6");

        // GAUSSIAN [0, 1]
        let (low, high) = apply_get_range(SquashType::Gaussian);
        assert_eq!(low, 0.0, "Gaussian low should be 0");
        assert_eq!(high, 1.0, "Gaussian high should be 1");
    }

    #[test]
    fn test_get_range_unbounded() {
        // IDENTITY - unbounded
        let (low, high) = apply_get_range(SquashType::Identity);
        assert!(low < -1e30, "Identity low should be very negative");
        assert!(high > 1e30, "Identity high should be very positive");

        // ReLU [0, inf)
        let (low, high) = apply_get_range(SquashType::Relu);
        assert_eq!(low, 0.0, "ReLU low should be 0");
        assert!(high > 1e30, "ReLU high should be very positive");
    }

    #[test]
    fn test_get_range_special_bounds() {
        // ArcTan [-pi/2, pi/2]
        let (low, high) = apply_get_range(SquashType::ArcTan);
        assert!(
            (low - (-std::f32::consts::FRAC_PI_2)).abs() < 1e-5,
            "ArcTan low should be -pi/2"
        );
        assert!(
            (high - std::f32::consts::FRAC_PI_2).abs() < 1e-5,
            "ArcTan high should be pi/2"
        );

        // LogSigmoid (-inf, 0]
        let (low, high) = apply_get_range(SquashType::LogSigmoid);
        assert!(low < -1e30, "LogSigmoid low should be very negative");
        assert_eq!(high, 0.0, "LogSigmoid high should be 0");

        // ELU [-1, inf)
        let (low, high) = apply_get_range(SquashType::Elu);
        assert_eq!(low, -1.0, "ELU low should be -1");
        assert!(high > 1e30, "ELU high should be very positive");

        // GELU has empirically determined minimum
        let (low, _) = apply_get_range(SquashType::Gelu);
        assert!(
            (low - (-0.17)).abs() < 0.01,
            "GELU low should be approximately -0.17"
        );
    }

    #[test]
    fn test_validate_range_valid() {
        // Valid values within range
        assert!(
            apply_validate_range(SquashType::Logistic, 0.5),
            "0.5 should be valid for Logistic"
        );
        assert!(
            apply_validate_range(SquashType::Logistic, 0.0),
            "0.0 should be valid for Logistic"
        );
        assert!(
            apply_validate_range(SquashType::Logistic, 1.0),
            "1.0 should be valid for Logistic"
        );

        assert!(
            apply_validate_range(SquashType::Tanh, 0.0),
            "0.0 should be valid for Tanh"
        );
        assert!(
            apply_validate_range(SquashType::Tanh, -0.5),
            "-0.5 should be valid for Tanh"
        );

        assert!(
            apply_validate_range(SquashType::Relu, 0.0),
            "0.0 should be valid for ReLU"
        );
        assert!(
            apply_validate_range(SquashType::Relu, 100.0),
            "100.0 should be valid for ReLU"
        );

        // Unbounded functions accept any finite value
        assert!(
            apply_validate_range(SquashType::Identity, -1000.0),
            "-1000 should be valid for Identity"
        );
        assert!(
            apply_validate_range(SquashType::Identity, 1000.0),
            "1000 should be valid for Identity"
        );
    }

    #[test]
    fn test_validate_range_invalid() {
        // Out of range values
        assert!(
            !apply_validate_range(SquashType::Logistic, -0.1),
            "-0.1 should be invalid for Logistic"
        );
        assert!(
            !apply_validate_range(SquashType::Logistic, 1.1),
            "1.1 should be invalid for Logistic"
        );

        assert!(
            !apply_validate_range(SquashType::Tanh, -1.5),
            "-1.5 should be invalid for Tanh"
        );
        assert!(
            !apply_validate_range(SquashType::Tanh, 1.5),
            "1.5 should be invalid for Tanh"
        );

        assert!(
            !apply_validate_range(SquashType::Relu, -1.0),
            "-1.0 should be invalid for ReLU"
        );

        // NaN and Infinity
        assert!(
            !apply_validate_range(SquashType::Logistic, f32::NAN),
            "NaN should be invalid"
        );
        assert!(
            !apply_validate_range(SquashType::Tanh, f32::INFINITY),
            "Infinity should be invalid"
        );
        assert!(
            !apply_validate_range(SquashType::Relu, f32::NEG_INFINITY),
            "-Infinity should be invalid"
        );
    }

    #[test]
    fn test_limit_range_clamping() {
        // Values within range should pass through
        assert_eq!(apply_limit_range(SquashType::Logistic, 0.5), 0.5);
        assert_eq!(apply_limit_range(SquashType::Tanh, 0.0), 0.0);

        // Values outside range should be clamped
        assert_eq!(apply_limit_range(SquashType::Logistic, -0.5), 0.0);
        assert_eq!(apply_limit_range(SquashType::Logistic, 1.5), 1.0);
        assert_eq!(apply_limit_range(SquashType::Tanh, -2.0), -1.0);
        assert_eq!(apply_limit_range(SquashType::Tanh, 2.0), 1.0);
        assert_eq!(apply_limit_range(SquashType::Relu6, 10.0), 6.0);
        assert_eq!(apply_limit_range(SquashType::Relu6, -1.0), 0.0);

        // Infinity should be clamped to bounds
        assert_eq!(apply_limit_range(SquashType::Logistic, f32::INFINITY), 1.0);
        assert_eq!(
            apply_limit_range(SquashType::Logistic, f32::NEG_INFINITY),
            0.0
        );
        assert_eq!(apply_limit_range(SquashType::Tanh, f32::INFINITY), 1.0);
        assert_eq!(apply_limit_range(SquashType::Tanh, f32::NEG_INFINITY), -1.0);

        // NaN should return 0
        assert_eq!(apply_limit_range(SquashType::Logistic, f32::NAN), 0.0);
    }

    #[test]
    fn test_range_aggregate_functions() {
        // Aggregate functions should have unbounded ranges
        let (low, high) = apply_get_range(SquashType::Minimum);
        assert!(low < -1e30, "Minimum low should be very negative");
        assert!(high > 1e30, "Minimum high should be very positive");

        let (low, high) = apply_get_range(SquashType::Maximum);
        assert!(low < -1e30, "Maximum low should be very negative");
        assert!(high > 1e30, "Maximum high should be very positive");

        let (low, high) = apply_get_range(SquashType::If);
        assert!(low < -1e30, "If low should be very negative");
        assert!(high > 1e30, "If high should be very positive");
    }
}

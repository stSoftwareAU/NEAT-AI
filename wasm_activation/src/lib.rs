//! WASM Activation Module for NEAT-AI
//!
//! This module provides WebAssembly implementations of neural network activation
//! functions for the NEAT-AI project. It is a prototype for Issue #1116 to evaluate
//! whether WASM can provide significant performance improvements over dynamically
//! generated JavaScript functions.
//!
//! The module implements a compiled activation function approach where:
//! 1. Network topology (weights, biases, connections) is serialised to a compact format
//! 2. The activation function iterates through neurons applying weighted sums and squash functions
//! 3. All computation happens in WASM linear memory to avoid JS/WASM boundary overhead
//!
//! Issue #1222 - Refactored from monolithic file into smaller modules for maintainability.

use wasm_bindgen::prelude::*;

// Module declarations
mod derivative;
mod error;
mod loss;
mod network;
mod range;
mod safe_zone;
mod simd;
mod squash;
mod synapse_type;
mod unsquash;

// Re-export public types and structs
pub use network::{CompiledNetwork, NeuronData, SynapseData};
pub use squash::SquashType;
pub use synapse_type::SynapseType;

// Re-export loss functions (these are #[wasm_bindgen] functions)
pub use loss::{
    cross_entropy_sum_batch_packed, hinge_sum_batch_packed, mae_sum_batch_packed,
    mape_sum_batch_packed, mse_sum_batch_packed, msle_sum_batch_packed,
};

// Internal module imports for standalone functions
use derivative::apply_derivative;
use error::apply_calculate_error;
use range::{apply_get_range, apply_limit_range, apply_validate_range};
use safe_zone::apply_safe_zone_adjustment;
use squash::apply_squash;
use unsquash::apply_unsquash;

// Issue #1213 - Export SIMD batch functions
pub use derivative::apply_derivative_simd_4way;
pub use error::apply_calculate_error_batch_4way;

// Re-export constants for tests
#[cfg(test)]
pub use squash::LEAKY_RELU_ALPHA;

/// Standalone squash function for testing
#[wasm_bindgen]
pub fn squash(squash_type: u8, value: f32) -> f32 {
    apply_squash(SquashType::from(squash_type), value)
}

/// Standalone derivative function for testing
/// Issue #1138 - WASM Migration Phase 6
#[wasm_bindgen]
pub fn derivative(squash_type: u8, value: f32) -> f32 {
    apply_derivative(SquashType::from(squash_type), value)
}

/// Standalone unsquash function for testing
/// Issue #1139 - WASM Migration Phase 7
///
/// Computes the inverse of the specified activation function at the given activation value.
/// The hint parameter guides the inverse for ambiguous or non-invertible functions.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `activation` - The squashed activation value to invert
/// * `hint` - A hint value to guide the inverse (use NaN or pass the original input value)
#[wasm_bindgen]
pub fn unsquash(squash_type: u8, activation: f32, hint: f32) -> f32 {
    apply_unsquash(SquashType::from(squash_type), activation, hint)
}

/// Standalone safe zone adjustment function for testing
/// Issue #1140 - WASM Migration Phase 8
///
/// Returns a float from 0 (not safe) to 1 (fully safe) indicating how useful it is
/// to backpropagate through a neuron based on saturation levels.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `raw_input` - The raw input value before squashing
/// * `error` - The error value from backpropagation
/// * `weight` - The synapse weight (use NaN if not applicable)
#[wasm_bindgen]
pub fn safe_zone_adjustment(squash_type: u8, raw_input: f32, error: f32, weight: f32) -> f32 {
    // If weight is NaN, use 1.0 as a neutral default
    let safe_weight = if weight.is_finite() { weight } else { 1.0 };
    apply_safe_zone_adjustment(SquashType::from(squash_type), raw_input, error, safe_weight)
}

/// Standalone calculate error function for testing
/// Issue #1141 - WASM Migration Phase 9
///
/// Calculates the error in value-space for backpropagation.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `current_activation` - The neuron's current output (after squash)
/// * `target_activation` - The desired output
/// * `current_value` - The pre-squash value (hint for unSquash)
#[wasm_bindgen]
pub fn calculate_error(
    squash_type: u8,
    current_activation: f32,
    target_activation: f32,
    current_value: f32,
) -> f32 {
    apply_calculate_error(
        SquashType::from(squash_type),
        current_activation,
        target_activation,
        current_value,
    )
}

/// Get the range (low, high) for an activation function
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns a Float32Array with two elements: [low, high]
/// representing the valid output range for the activation function.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
#[wasm_bindgen]
pub fn get_range(squash_type: u8) -> js_sys::Float32Array {
    let (low, high) = apply_get_range(SquashType::from(squash_type));
    let result = js_sys::Float32Array::new_with_length(2);
    result.set_index(0, low);
    result.set_index(1, high);
    result
}

/// Validate that an activation value is within the valid range
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns true if the activation is within the valid range for the
/// specified activation function, false otherwise.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `activation` - The activation value to validate
#[wasm_bindgen]
pub fn validate_range(squash_type: u8, activation: f32) -> bool {
    apply_validate_range(SquashType::from(squash_type), activation)
}

/// Clamp a value to the valid range for an activation function
/// Issue #1142 - WASM Migration Phase 10
///
/// Returns the value clamped to the valid range for the specified
/// activation function. Infinity values are clamped to the bounds.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `value` - The value to clamp
#[wasm_bindgen]
pub fn limit_range(squash_type: u8, value: f32) -> f32 {
    apply_limit_range(SquashType::from(squash_type), value)
}

/// Issue #1213 - Batch derivative computation for 4 values simultaneously.
///
/// Returns a Float32Array with 4 derivative values computed in parallel using SIMD.
/// This provides significant performance improvements during backpropagation.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `x0, x1, x2, x3` - The 4 input values to compute derivatives for
#[wasm_bindgen]
pub fn derivative_batch_4way(
    squash_type: u8,
    x0: f32,
    x1: f32,
    x2: f32,
    x3: f32,
) -> js_sys::Float32Array {
    let (d0, d1, d2, d3) =
        apply_derivative_simd_4way(SquashType::from(squash_type), x0, x1, x2, x3);

    let result = js_sys::Float32Array::new_with_length(4);
    result.set_index(0, d0);
    result.set_index(1, d1);
    result.set_index(2, d2);
    result.set_index(3, d3);
    result
}

/// Issue #1213 - Batch error calculation for 4 records simultaneously.
///
/// Returns a Float32Array with 4 error values computed for backpropagation.
/// This provides significant performance improvements during mini-batch training.
///
/// # Arguments
/// * `squash_type` - The SquashType enum value (u8)
/// * `current_activations` - Float32Array of 4 current activation values
/// * `target_activations` - Float32Array of 4 target activation values
/// * `current_values` - Float32Array of 4 pre-squash values (hints for unSquash)
#[wasm_bindgen]
pub fn calculate_error_batch_4way(
    squash_type: u8,
    current_activations: &js_sys::Float32Array,
    target_activations: &js_sys::Float32Array,
    current_values: &js_sys::Float32Array,
) -> js_sys::Float32Array {
    let curr_acts: [f32; 4] = [
        current_activations.get_index(0),
        current_activations.get_index(1),
        current_activations.get_index(2),
        current_activations.get_index(3),
    ];
    let tgt_acts: [f32; 4] = [
        target_activations.get_index(0),
        target_activations.get_index(1),
        target_activations.get_index(2),
        target_activations.get_index(3),
    ];
    let curr_vals: [f32; 4] = [
        current_values.get_index(0),
        current_values.get_index(1),
        current_values.get_index(2),
        current_values.get_index(3),
    ];

    let (e0, e1, e2, e3) = apply_calculate_error_batch_4way(
        SquashType::from(squash_type),
        &curr_acts,
        &tgt_acts,
        &curr_vals,
    );

    let result = js_sys::Float32Array::new_with_length(4);
    result.set_index(0, e0);
    result.set_index(1, e1);
    result.set_index(2, e2);
    result.set_index(3, e3);
    result
}

/// Version information
#[wasm_bindgen]
pub fn version() -> String {
    "0.1.0".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relu() {
        assert_eq!(apply_squash(SquashType::Relu, 1.0), 1.0);
        assert_eq!(apply_squash(SquashType::Relu, -1.0), 0.0);
        assert_eq!(apply_squash(SquashType::Relu, 0.0), 0.0);
    }

    #[test]
    fn test_tanh() {
        let result = apply_squash(SquashType::Tanh, 0.0);
        assert!((result - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_logistic() {
        let result = apply_squash(SquashType::Logistic, 0.0);
        assert!((result - 0.5).abs() < 1e-6);
    }

    // Issue #1138 - Derivative tests
    #[test]
    fn test_derivative_identity() {
        assert_eq!(apply_derivative(SquashType::Identity, 0.0), 1.0);
        assert_eq!(apply_derivative(SquashType::Identity, 5.0), 1.0);
        assert_eq!(apply_derivative(SquashType::Identity, -5.0), 1.0);
    }

    #[test]
    fn test_derivative_relu() {
        assert_eq!(apply_derivative(SquashType::Relu, 1.0), 1.0);
        assert_eq!(apply_derivative(SquashType::Relu, -1.0), 0.0);
        assert_eq!(apply_derivative(SquashType::Relu, 0.0), 0.0);
    }

    #[test]
    fn test_derivative_leaky_relu() {
        assert_eq!(apply_derivative(SquashType::LeakyRelu, 1.0), 1.0);
        assert_eq!(
            apply_derivative(SquashType::LeakyRelu, -1.0),
            LEAKY_RELU_ALPHA
        );
        assert_eq!(apply_derivative(SquashType::LeakyRelu, 0.0), 1.0);
    }

    #[test]
    fn test_derivative_logistic() {
        // At x=0, sigmoid(0) = 0.5, so derivative = 0.5 * 0.5 = 0.25
        let result = apply_derivative(SquashType::Logistic, 0.0);
        assert!((result - 0.25).abs() < 1e-6);
    }

    #[test]
    fn test_derivative_tanh() {
        // At x=0, tanh(0) = 0, so derivative = 1 - 0^2 = 1
        let result = apply_derivative(SquashType::Tanh, 0.0);
        assert!((result - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_derivative_sine() {
        // sin'(x) = cos(x)
        let result = apply_derivative(SquashType::Sine, 0.0);
        assert!((result - 1.0).abs() < 1e-6); // cos(0) = 1
    }

    #[test]
    fn test_derivative_cosine() {
        // cos'(x) = -sin(x)
        let result = apply_derivative(SquashType::Cosine, 0.0);
        assert!((result - 0.0).abs() < 1e-6); // -sin(0) = 0
    }

    #[test]
    fn test_derivative_square() {
        // (x^2)' = 2x
        assert_eq!(apply_derivative(SquashType::Square, 0.0), 0.0);
        assert_eq!(apply_derivative(SquashType::Square, 2.0), 4.0);
        assert_eq!(apply_derivative(SquashType::Square, -3.0), -6.0);
    }

    #[test]
    fn test_derivative_cube() {
        // (x^3)' = 3x^2
        assert_eq!(apply_derivative(SquashType::Cube, 0.0), 0.0);
        assert_eq!(apply_derivative(SquashType::Cube, 2.0), 12.0);
        assert_eq!(apply_derivative(SquashType::Cube, -2.0), 12.0);
    }

    #[test]
    fn test_derivative_complement() {
        // (1-x)' = -1
        assert_eq!(apply_derivative(SquashType::Complement, 0.0), -1.0);
        assert_eq!(apply_derivative(SquashType::Complement, 5.0), -1.0);
    }

    #[test]
    fn test_derivative_absolute() {
        assert_eq!(apply_derivative(SquashType::Absolute, 1.0), 1.0);
        assert_eq!(apply_derivative(SquashType::Absolute, -1.0), -1.0);
        assert_eq!(apply_derivative(SquashType::Absolute, 0.0), 0.0);
    }

    #[test]
    fn test_derivative_arctan() {
        // atan'(x) = 1/(1+x^2)
        let result = apply_derivative(SquashType::ArcTan, 0.0);
        assert!((result - 1.0).abs() < 1e-6); // 1/(1+0) = 1

        let result2 = apply_derivative(SquashType::ArcTan, 1.0);
        assert!((result2 - 0.5).abs() < 1e-6); // 1/(1+1) = 0.5
    }

    #[test]
    fn test_derivative_aggregate_functions() {
        // Aggregate functions return 0
        assert_eq!(apply_derivative(SquashType::Minimum, 1.0), 0.0);
        assert_eq!(apply_derivative(SquashType::Maximum, 1.0), 0.0);
        assert_eq!(apply_derivative(SquashType::If, 1.0), 0.0);
    }

    // Issue #1139 - UnSquash tests
    #[test]
    fn test_unsquash_identity() {
        // Identity: f⁻¹(y) = y
        assert_eq!(apply_unsquash(SquashType::Identity, 0.0, 0.0), 0.0);
        assert_eq!(apply_unsquash(SquashType::Identity, 5.0, 0.0), 5.0);
        assert_eq!(apply_unsquash(SquashType::Identity, -5.0, 0.0), -5.0);
    }

    #[test]
    fn test_unsquash_relu() {
        // ReLU: f⁻¹(y) = y for y > 0, else hint
        assert_eq!(apply_unsquash(SquashType::Relu, 5.0, 0.0), 5.0);
        assert_eq!(apply_unsquash(SquashType::Relu, 0.0, -3.0), -3.0);
        assert_eq!(apply_unsquash(SquashType::Relu, 0.0, f32::NAN), 0.0);
    }

    #[test]
    fn test_unsquash_leaky_relu() {
        // LeakyReLU: f⁻¹(y) = y >= 0 ? y : y / alpha
        assert_eq!(apply_unsquash(SquashType::LeakyRelu, 1.0, 0.0), 1.0);
        // For y = -0.01, x = -0.01 / 0.01 = -1.0
        let result = apply_unsquash(SquashType::LeakyRelu, -0.01, 0.0);
        assert!((result - (-1.0)).abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_logistic() {
        // Logistic: f⁻¹(y) = log(y / (1 - y))
        // At y = 0.5, x = log(0.5 / 0.5) = log(1) = 0
        let result = apply_unsquash(SquashType::Logistic, 0.5, 0.0);
        assert!(result.abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_tanh() {
        // TANH: f⁻¹(y) = 0.5 * log((1 + y) / (1 - y))
        // At y = 0, x = 0.5 * log(1/1) = 0
        let result = apply_unsquash(SquashType::Tanh, 0.0, 0.0);
        assert!(result.abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_complement() {
        // Complement: f⁻¹(y) = 1 - y
        assert_eq!(apply_unsquash(SquashType::Complement, 0.0, 0.0), 1.0);
        assert_eq!(apply_unsquash(SquashType::Complement, 0.5, 0.0), 0.5);
        assert_eq!(apply_unsquash(SquashType::Complement, 1.0, 0.0), 0.0);
    }

    #[test]
    fn test_unsquash_cube() {
        // Cube: f⁻¹(y) = cbrt(y)
        assert_eq!(apply_unsquash(SquashType::Cube, 0.0, 0.0), 0.0);
        let result = apply_unsquash(SquashType::Cube, 8.0, 0.0);
        assert!((result - 2.0).abs() < 1e-5);
        let result2 = apply_unsquash(SquashType::Cube, -8.0, 0.0);
        assert!((result2 - (-2.0)).abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_square() {
        // Square: f⁻¹(y) = ±sqrt(y) based on hint
        let result = apply_unsquash(SquashType::Square, 4.0, 2.0);
        assert!((result - 2.0).abs() < 1e-5);
        let result2 = apply_unsquash(SquashType::Square, 4.0, -2.0);
        assert!((result2 - (-2.0)).abs() < 1e-5);
    }

    #[test]
    fn test_unsquash_roundtrip() {
        // Test roundtrip: squash(x) -> unsquash(activation, x) should give x back
        let test_values = [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0];

        for &x in &test_values {
            // Identity
            let activation = apply_squash(SquashType::Identity, x);
            let recovered = apply_unsquash(SquashType::Identity, activation, x);
            assert!(
                (recovered - x).abs() < 1e-5,
                "Identity roundtrip failed for x={}",
                x
            );

            // LeakyReLU
            let activation = apply_squash(SquashType::LeakyRelu, x);
            let recovered = apply_unsquash(SquashType::LeakyRelu, activation, x);
            assert!(
                (recovered - x).abs() < 1e-4,
                "LeakyReLU roundtrip failed for x={}",
                x
            );

            // Complement
            let activation = apply_squash(SquashType::Complement, x);
            let recovered = apply_unsquash(SquashType::Complement, activation, x);
            assert!(
                (recovered - x).abs() < 1e-5,
                "Complement roundtrip failed for x={}",
                x
            );

            // Cube
            let activation = apply_squash(SquashType::Cube, x);
            let recovered = apply_unsquash(SquashType::Cube, activation, x);
            assert!(
                (recovered - x).abs() < 1e-5,
                "Cube roundtrip failed for x={}",
                x
            );
        }
    }

    #[test]
    fn test_unsquash_aggregate_functions() {
        // Aggregate functions return hint if provided
        assert_eq!(apply_unsquash(SquashType::Minimum, 1.0, 42.0), 42.0);
        assert_eq!(apply_unsquash(SquashType::Maximum, 1.0, 42.0), 42.0);
        assert_eq!(apply_unsquash(SquashType::If, 1.0, 42.0), 42.0);
    }

    // Issue #1141 - CalculateError tests
    #[test]
    fn test_calculate_error_identity() {
        // Identity: error = rawError (slope = 1)
        let error = apply_calculate_error(SquashType::Identity, 0.5, 0.8, 0.5);
        assert!(
            (error - 0.3).abs() < 1e-5,
            "Identity error should be 0.3, got {}",
            error
        );

        // Tiny error should return 0
        let tiny_error = apply_calculate_error(SquashType::Identity, 0.5, 0.5 + 1e-8, 0.5);
        assert_eq!(tiny_error, 0.0, "Tiny error should return 0");
    }

    #[test]
    fn test_calculate_error_complement() {
        // Complement: error = rawError / -1 = -rawError
        let error = apply_calculate_error(SquashType::Complement, 0.5, 0.8, 0.5);
        assert!(
            (error - (-0.3)).abs() < 1e-5,
            "Complement error should be -0.3, got {}",
            error
        );
    }

    #[test]
    fn test_calculate_error_relu() {
        // ReLU: use raw error when active
        let error = apply_calculate_error(SquashType::Relu, 2.0, 3.0, 2.0);
        assert!(
            (error - 1.0).abs() < 1e-5,
            "ReLU active error should be 1.0, got {}",
            error
        );

        // ReLU: dead neuron uses unSquash fallback
        let dead_error = apply_calculate_error(SquashType::Relu, 0.0, 1.0, -1.0);
        assert!(dead_error.is_finite(), "ReLU dead error should be finite");
    }

    #[test]
    fn test_calculate_error_tanh() {
        // TANH: use derivative when slope is strong
        let current_value = 0.0;
        let activation = (current_value as f32).tanh(); // 0.0
        let error = apply_calculate_error(SquashType::Tanh, activation, 0.5, current_value);
        // At x=0, derivative = 1, so error = rawError / 1 = 0.5
        assert!(
            (error - 0.5).abs() < 1e-4,
            "TANH error at x=0 should be ~0.5, got {}",
            error
        );
    }

    #[test]
    fn test_calculate_error_absolute() {
        // ABSOLUTE: uses closest target approach
        // currentValue = -2, activation = 2, target = 1
        // Options: -1 or +1 as targets
        // closest to -2 is -1, so error = -1 - (-2) = 1
        let error = apply_calculate_error(SquashType::Absolute, 2.0, 1.0, -2.0);
        assert!(
            (error - 1.0).abs() < 1e-5,
            "Absolute error should be 1.0, got {}",
            error
        );
    }

    #[test]
    fn test_calculate_error_clamping() {
        // Test that errors are clamped to ±100
        let large_error = apply_calculate_error(SquashType::Identity, 0.0, 1000.0, 0.0);
        assert!(
            large_error.abs() <= 100.0,
            "Error should be clamped to ±100, got {}",
            large_error
        );

        let neg_large_error = apply_calculate_error(SquashType::Identity, 1000.0, 0.0, 1000.0);
        assert!(
            neg_large_error.abs() <= 100.0,
            "Negative error should be clamped to ±100, got {}",
            neg_large_error
        );
    }

    #[test]
    fn test_calculate_error_aggregate_functions() {
        // Aggregate functions should return 0
        assert_eq!(
            apply_calculate_error(SquashType::Minimum, 0.5, 0.8, 0.5),
            0.0
        );
        assert_eq!(
            apply_calculate_error(SquashType::Maximum, 0.5, 0.8, 0.5),
            0.0
        );
        assert_eq!(apply_calculate_error(SquashType::If, 0.5, 0.8, 0.5), 0.0);
    }

    // Issue #1142 - Range Validation tests
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
        // ArcTan [-π/2, π/2]
        let (low, high) = apply_get_range(SquashType::ArcTan);
        assert!(
            (low - (-std::f32::consts::FRAC_PI_2)).abs() < 1e-5,
            "ArcTan low should be -π/2"
        );
        assert!(
            (high - std::f32::consts::FRAC_PI_2).abs() < 1e-5,
            "ArcTan high should be π/2"
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

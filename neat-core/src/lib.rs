//! Shared computation library for NEAT-AI neural network operations.
//!
//! This crate contains the core neural network logic extracted from the
//! `wasm_activation` crate. It is pure Rust with no WASM, `wasm-bindgen`,
//! or `js-sys` dependencies, allowing it to be compiled for both
//! `wasm32-unknown-unknown` and native targets (x86_64, aarch64).
//!
//! Issue #1964 - Extract shared Rust library crate from wasm_activation.

// Core computation modules
pub mod accumulate;
pub mod derivative;
pub mod elastic_distribution;
pub mod error;
pub mod fused_error;
pub mod loss;
pub mod network;
pub mod pc_inference;
pub mod pc_learning;
pub mod range;
pub mod safe_zone;
pub mod score_scan;
pub mod simd;
pub mod squash;
pub mod synapse_type;
pub mod training_state;
pub mod unsquash;

// Re-export key types for convenience
pub use network::{CompiledNetwork, NeuronData, SynapseData};
pub use pc_inference::PredictiveCodingEngine;
pub use squash::SquashType;
pub use synapse_type::SynapseType;

// Re-export core functions
pub use accumulate::{
    accumulate_bias_batch_4way, accumulate_bias_batch_8way, accumulate_weight_batch_4way,
    accumulate_weight_batch_8way, calculate_bias, calculate_weight,
};
pub use derivative::{apply_derivative, apply_derivative_simd_4way};
pub use elastic_distribution::distribute_elastic_error;
pub use error::{apply_calculate_error, apply_calculate_error_batch_4way};
pub use fused_error::apply_fused_error_distribution;
pub use loss::{
    cross_entropy_sum_batch_packed, hinge_sum_batch_packed, mae_sum_batch_packed,
    mape_sum_batch_packed, mse_sum_batch_packed, msle_sum_batch_packed,
};
pub use range::{apply_get_range, apply_limit_range, apply_validate_range};
pub use safe_zone::{apply_safe_zone_adjustment, apply_safe_zone_adjustment_batch};
pub use score_scan::{compute_score_components, scan_max_bias, scan_max_weight};
pub use squash::apply_squash;
pub use training_state::{
    accumulate_bias_persistent_4way, accumulate_bias_persistent_8way,
    accumulate_weight_persistent_4way, accumulate_weight_persistent_8way, free_training_state,
    get_training_state_num_neurons, get_training_state_num_synapses, init_training_state,
    read_all_neuron_state, read_all_synapse_state, read_neuron_state, read_synapse_state,
    reset_training_state,
};
pub use unsquash::apply_unsquash;

#[cfg(test)]
pub use squash::LEAKY_RELU_ALPHA;

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
    fn test_unsquash_identity() {
        assert_eq!(apply_unsquash(SquashType::Identity, 0.0, 0.0), 0.0);
        assert_eq!(apply_unsquash(SquashType::Identity, 5.0, 0.0), 5.0);
        assert_eq!(apply_unsquash(SquashType::Identity, -5.0, 0.0), -5.0);
    }

    #[test]
    fn test_calculate_error() {
        let error = apply_calculate_error(SquashType::Identity, 0.5, 1.0, 0.5);
        assert!((error - 0.5).abs() < 1e-5);
    }

    #[test]
    fn test_safe_zone_adjustment() {
        let factor = apply_safe_zone_adjustment(SquashType::Identity, 0.5, 0.1, 1.0);
        assert!(factor >= 0.0 && factor <= 1.0);
    }

    #[test]
    fn test_get_range() {
        let (low, high) = apply_get_range(SquashType::Logistic);
        assert!((low - 0.0).abs() < 1e-6);
        assert!((high - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_validate_range() {
        assert!(apply_validate_range(SquashType::Logistic, 0.5));
        assert!(!apply_validate_range(SquashType::Logistic, -0.5));
    }

    #[test]
    fn test_limit_range() {
        let result = apply_limit_range(SquashType::Logistic, 2.0);
        assert!((result - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_version_constant() {
        // Verify the crate compiles and basic types are accessible
        let _ = SquashType::Relu;
        let _ = SynapseType::Standard;
    }
}

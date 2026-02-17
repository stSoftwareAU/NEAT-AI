//! Issue #1522 - Persistent training state in WASM linear memory.
//!
//! Keeps synapse and neuron training state (accumulators, counts) in WASM
//! linear memory across backpropagation iterations. This eliminates the
//! per-iteration marshalling of JS objects ↔ WASM typed arrays.
//!
//! ## Memory layout
//!
//! ### Per-synapse state (7 × f64 = 56 bytes each):
//!   - count
//!   - totalPositiveActivation
//!   - totalNegativeActivation
//!   - countPositiveActivations
//!   - countNegativeActivations
//!   - totalPositiveAdjustedValue
//!   - totalNegativeAdjustedValue
//!
//! ### Per-neuron state (3 × f64 = 24 bytes each):
//!   - count
//!   - totalBias
//!   - totalAdjustedBias

use std::cell::RefCell;
use wasm_bindgen::prelude::*;

use crate::accumulate::{accumulate_bias_single, accumulate_weight_single};

/// Number of f64 fields per synapse in the training state.
const SYNAPSE_FIELDS: usize = 7;

/// Number of f64 fields per neuron in the training state.
const NEURON_FIELDS: usize = 3;

// Thread-local persistent training state.
// Using `RefCell` because WASM is single-threaded and we need interior
// mutability for the global state that persists across function calls.
thread_local! {
    static SYNAPSE_STATE: RefCell<Vec<f64>> = RefCell::new(Vec::new());
    static NEURON_STATE: RefCell<Vec<f64>> = RefCell::new(Vec::new());
    static NUM_SYNAPSES: RefCell<usize> = RefCell::new(0);
    static NUM_NEURONS: RefCell<usize> = RefCell::new(0);
}

/// Initialise persistent training state for an epoch.
///
/// Allocates and zeroes the synapse and neuron state arrays in WASM linear
/// memory. Call this once at the start of each training epoch.
///
/// # Arguments
/// * `num_synapses` - Number of synapses in the network
/// * `num_neurons` - Number of neurons in the network
#[wasm_bindgen]
pub fn init_training_state(num_synapses: usize, num_neurons: usize) {
    SYNAPSE_STATE.with(|s| {
        let mut state = s.borrow_mut();
        let required = num_synapses * SYNAPSE_FIELDS;
        state.resize(required, 0.0);
        state.fill(0.0);
    });
    NEURON_STATE.with(|s| {
        let mut state = s.borrow_mut();
        let required = num_neurons * NEURON_FIELDS;
        state.resize(required, 0.0);
        state.fill(0.0);
    });
    NUM_SYNAPSES.with(|n| *n.borrow_mut() = num_synapses);
    NUM_NEURONS.with(|n| *n.borrow_mut() = num_neurons);
}

/// Reset all training state to zero without deallocating.
///
/// More efficient than `init_training_state` when the network size
/// hasn't changed — avoids reallocation.
#[wasm_bindgen]
pub fn reset_training_state() {
    SYNAPSE_STATE.with(|s| s.borrow_mut().fill(0.0));
    NEURON_STATE.with(|s| s.borrow_mut().fill(0.0));
}

/// Free all training state memory.
///
/// Call this when training is complete to release WASM linear memory.
#[wasm_bindgen]
pub fn free_training_state() {
    SYNAPSE_STATE.with(|s| {
        let mut state = s.borrow_mut();
        *state = Vec::new();
    });
    NEURON_STATE.with(|s| {
        let mut state = s.borrow_mut();
        *state = Vec::new();
    });
    NUM_SYNAPSES.with(|n| *n.borrow_mut() = 0);
    NUM_NEURONS.with(|n| *n.borrow_mut() = 0);
}

/// Read the persistent state for a single synapse.
///
/// Returns a packed f64 array with 7 values:
///   [count, totalPositiveActivation, totalNegativeActivation,
///    countPositiveActivations, countNegativeActivations,
///    totalPositiveAdjustedValue, totalNegativeAdjustedValue]
#[wasm_bindgen]
pub fn read_synapse_state(index: usize) -> Vec<f64> {
    SYNAPSE_STATE.with(|s| {
        let state = s.borrow();
        let base = index * SYNAPSE_FIELDS;
        if base + SYNAPSE_FIELDS <= state.len() {
            state[base..base + SYNAPSE_FIELDS].to_vec()
        } else {
            vec![0.0; SYNAPSE_FIELDS]
        }
    })
}

/// Read the persistent state for a single neuron.
///
/// Returns a packed f64 array with 3 values:
///   [count, totalBias, totalAdjustedBias]
#[wasm_bindgen]
pub fn read_neuron_state(index: usize) -> Vec<f64> {
    NEURON_STATE.with(|s| {
        let state = s.borrow();
        let base = index * NEURON_FIELDS;
        if base + NEURON_FIELDS <= state.len() {
            state[base..base + NEURON_FIELDS].to_vec()
        } else {
            vec![0.0; NEURON_FIELDS]
        }
    })
}

/// Read all synapse state as a bulk f64 array.
///
/// Returns the entire synapse state buffer (num_synapses × 7 values).
/// More efficient than calling `read_synapse_state` per synapse.
#[wasm_bindgen]
pub fn read_all_synapse_state() -> Vec<f64> {
    SYNAPSE_STATE.with(|s| s.borrow().clone())
}

/// Read all neuron state as a bulk f64 array.
///
/// Returns the entire neuron state buffer (num_neurons × 3 values).
/// More efficient than calling `read_neuron_state` per neuron.
#[wasm_bindgen]
pub fn read_all_neuron_state() -> Vec<f64> {
    NEURON_STATE.with(|s| s.borrow().clone())
}

/// Accumulate weight adjustments for 4 synapses into persistent state.
///
/// Same arithmetic as `accumulate_weight_batch_4way`, but results are
/// accumulated directly into the persistent state buffer rather than
/// being returned to JavaScript.
///
/// # Arguments
/// * `start_index` - Index of the first synapse in the state buffer
/// * `current_weights` - 4 current synapse weights
/// * `target_values` - 4 target values for weight calculation
/// * `activations` - 4 activation values from source neurons
/// * `plank_constant` - Minimum unit threshold
/// * `learning_rate` - Learning rate for weight adjustment
/// * `max_weight_adj_scale` - Maximum weight adjustment scale
/// * `limit_weight_scale` - Global weight scale limit
#[wasm_bindgen]
pub fn accumulate_weight_persistent_4way(
    start_index: usize,
    current_weights: &[f64],
    target_values: &[f64],
    activations: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
) {
    SYNAPSE_STATE.with(|s| {
        let mut state = s.borrow_mut();

        for i in 0..4 {
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

            if d_count > 0.0 {
                let base = (start_index + i) * SYNAPSE_FIELDS;
                if base + SYNAPSE_FIELDS <= state.len() {
                    state[base] += d_count;
                    state[base + 1] += d_pos_act;
                    state[base + 2] += d_neg_act;
                    state[base + 3] += d_cnt_pos;
                    state[base + 4] += d_cnt_neg;
                    state[base + 5] += d_pos_adj;
                    state[base + 6] += d_neg_adj;
                }
            }
        }
    });
}

/// Accumulate weight adjustments for 8 synapses into persistent state.
#[wasm_bindgen]
pub fn accumulate_weight_persistent_8way(
    start_index: usize,
    current_weights: &[f64],
    target_values: &[f64],
    activations: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
) {
    SYNAPSE_STATE.with(|s| {
        let mut state = s.borrow_mut();

        for i in 0..8 {
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

            if d_count > 0.0 {
                let base = (start_index + i) * SYNAPSE_FIELDS;
                if base + SYNAPSE_FIELDS <= state.len() {
                    state[base] += d_count;
                    state[base + 1] += d_pos_act;
                    state[base + 2] += d_neg_act;
                    state[base + 3] += d_cnt_pos;
                    state[base + 4] += d_cnt_neg;
                    state[base + 5] += d_pos_adj;
                    state[base + 6] += d_neg_adj;
                }
            }
        }
    });
}

/// Accumulate bias adjustments for 4 neurons into persistent state.
///
/// Same arithmetic as `accumulate_bias_batch_4way`, but results are
/// accumulated directly into the persistent state buffer.
///
/// # Arguments
/// * `start_index` - Index of the first neuron in the state buffer
/// * `target_pre_activations` - 4 target pre-activation values
/// * `pre_activations` - 4 current pre-activation values
/// * `current_biases` - 4 current neuron biases
/// * `plank_constant` - Minimum unit threshold
/// * `learning_rate` - Learning rate for bias adjustment
/// * `max_bias_adj_scale` - Maximum bias adjustment scale
/// * `limit_bias_scale` - Global bias scale limit
#[wasm_bindgen]
pub fn accumulate_bias_persistent_4way(
    start_index: usize,
    target_pre_activations: &[f64],
    pre_activations: &[f64],
    current_biases: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) {
    NEURON_STATE.with(|s| {
        let mut state = s.borrow_mut();

        for i in 0..4 {
            let (d_count, d_total_bias, d_adj_bias) = accumulate_bias_single(
                target_pre_activations[i],
                pre_activations[i],
                current_biases[i],
                plank_constant,
                learning_rate,
                max_bias_adj_scale,
                limit_bias_scale,
            );

            if d_count > 0.0 {
                let base = (start_index + i) * NEURON_FIELDS;
                if base + NEURON_FIELDS <= state.len() {
                    state[base] += d_count;
                    state[base + 1] += d_total_bias;
                    state[base + 2] += d_adj_bias;
                }
            }
        }
    });
}

/// Accumulate bias adjustments for 8 neurons into persistent state.
#[wasm_bindgen]
pub fn accumulate_bias_persistent_8way(
    start_index: usize,
    target_pre_activations: &[f64],
    pre_activations: &[f64],
    current_biases: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) {
    NEURON_STATE.with(|s| {
        let mut state = s.borrow_mut();

        for i in 0..8 {
            let (d_count, d_total_bias, d_adj_bias) = accumulate_bias_single(
                target_pre_activations[i],
                pre_activations[i],
                current_biases[i],
                plank_constant,
                learning_rate,
                max_bias_adj_scale,
                limit_bias_scale,
            );

            if d_count > 0.0 {
                let base = (start_index + i) * NEURON_FIELDS;
                if base + NEURON_FIELDS <= state.len() {
                    state[base] += d_count;
                    state[base + 1] += d_total_bias;
                    state[base + 2] += d_adj_bias;
                }
            }
        }
    });
}

/// Get the number of synapses in the current training state.
#[wasm_bindgen]
pub fn get_training_state_num_synapses() -> usize {
    NUM_SYNAPSES.with(|n| *n.borrow())
}

/// Get the number of neurons in the current training state.
#[wasm_bindgen]
pub fn get_training_state_num_neurons() -> usize {
    NUM_NEURONS.with(|n| *n.borrow())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_and_reset() {
        init_training_state(4, 2);

        assert_eq!(get_training_state_num_synapses(), 4);
        assert_eq!(get_training_state_num_neurons(), 2);

        // State should be zeroed
        let syn = read_synapse_state(0);
        assert_eq!(syn.len(), SYNAPSE_FIELDS);
        for &v in &syn {
            assert_eq!(v, 0.0);
        }

        let neu = read_neuron_state(0);
        assert_eq!(neu.len(), NEURON_FIELDS);
        for &v in &neu {
            assert_eq!(v, 0.0);
        }

        free_training_state();
        assert_eq!(get_training_state_num_synapses(), 0);
    }

    #[test]
    fn test_weight_accumulation_persistent() {
        init_training_state(4, 0);

        let weights = vec![0.5, -0.3, 1.2, 0.0];
        let targets = vec![2.0, -1.5, 0.8, 3.0];
        let acts = vec![1.0, 0.5, -0.8, 2.0];

        accumulate_weight_persistent_4way(
            0,
            &weights,
            &targets,
            &acts,
            1e-7, 1.0, 1.0, 100000.0,
        );

        // Verify state was accumulated
        let s0 = read_synapse_state(0);
        assert_eq!(s0[0], 1.0, "count should be 1");
        assert!(s0[1] > 0.0, "positive activation should be tracked");

        // Second iteration should accumulate
        accumulate_weight_persistent_4way(
            0,
            &weights,
            &targets,
            &acts,
            1e-7, 1.0, 1.0, 100000.0,
        );

        let s0_after = read_synapse_state(0);
        assert_eq!(s0_after[0], 2.0, "count should be 2 after second iteration");

        free_training_state();
    }

    #[test]
    fn test_bias_accumulation_persistent() {
        init_training_state(0, 4);

        let target_pres = vec![2.0, -1.5, 0.8, 3.0];
        let pres = vec![1.0, -0.5, 0.2, 2.5];
        let biases = vec![0.5, -0.3, 1.2, 0.0];

        accumulate_bias_persistent_4way(
            0,
            &target_pres,
            &pres,
            &biases,
            1e-7, 1.0, 1.0, 10000.0,
        );

        let n0 = read_neuron_state(0);
        assert_eq!(n0[0], 1.0, "count should be 1");
        assert_eq!(n0[1], 1.5, "totalBias should be target_bias = 0.5 + (2.0 - 1.0) = 1.5");

        free_training_state();
    }

    #[test]
    fn test_persistent_matches_batch() {
        // Compare persistent accumulation with batch accumulation
        let weights = vec![0.5, -0.3, 1.2, 0.0];
        let targets = vec![2.0, -1.5, 0.8, 3.0];
        let acts = vec![1.0, 0.5, -0.8, 2.0];
        let plank = 1e-7;
        let lr = 1.0;
        let max_adj = 1.0;
        let limit = 100000.0;

        // Batch approach
        let batch_result = crate::accumulate::accumulate_weight_batch_4way(
            &weights, &targets, &acts, plank, lr, max_adj, limit,
        );

        // Persistent approach
        init_training_state(4, 0);
        accumulate_weight_persistent_4way(0, &weights, &targets, &acts, plank, lr, max_adj, limit);

        for i in 0..4 {
            let persistent = read_synapse_state(i);
            let batch_base = i * SYNAPSE_FIELDS;

            for f in 0..SYNAPSE_FIELDS {
                assert!(
                    (persistent[f] - batch_result[batch_base + f]).abs() < 1e-10,
                    "Mismatch at synapse {} field {}: persistent={}, batch={}",
                    i, f, persistent[f], batch_result[batch_base + f]
                );
            }
        }

        free_training_state();
    }

    #[test]
    fn test_persistent_bias_matches_batch() {
        let target_pres = vec![2.0, -1.5, 0.8, 3.0];
        let pres = vec![1.0, -0.5, 0.2, 2.5];
        let biases = vec![0.5, -0.3, 1.2, 0.0];
        let plank = 1e-7;
        let lr = 1.0;
        let max_adj = 1.0;
        let limit = 10000.0;

        // Batch approach
        let batch_result = crate::accumulate::accumulate_bias_batch_4way(
            &target_pres, &pres, &biases, plank, lr, max_adj, limit,
        );

        // Persistent approach
        init_training_state(0, 4);
        accumulate_bias_persistent_4way(
            0, &target_pres, &pres, &biases, plank, lr, max_adj, limit,
        );

        for i in 0..4 {
            let persistent = read_neuron_state(i);
            let batch_base = i * NEURON_FIELDS;

            for f in 0..NEURON_FIELDS {
                assert!(
                    (persistent[f] - batch_result[batch_base + f]).abs() < 1e-10,
                    "Mismatch at neuron {} field {}: persistent={}, batch={}",
                    i, f, persistent[f], batch_result[batch_base + f]
                );
            }
        }

        free_training_state();
    }

    #[test]
    fn test_reset_zeroes_state() {
        init_training_state(4, 2);

        let weights = vec![0.5, -0.3, 1.2, 0.0];
        let targets = vec![2.0, -1.5, 0.8, 3.0];
        let acts = vec![1.0, 0.5, -0.8, 2.0];

        accumulate_weight_persistent_4way(0, &weights, &targets, &acts, 1e-7, 1.0, 1.0, 100000.0);

        // Verify state is non-zero
        let s0 = read_synapse_state(0);
        assert!(s0[0] > 0.0);

        // Reset
        reset_training_state();

        // Verify all zeroed
        let s0_after = read_synapse_state(0);
        for &v in &s0_after {
            assert_eq!(v, 0.0);
        }

        free_training_state();
    }

    #[test]
    fn test_bulk_read() {
        init_training_state(2, 2);

        let weights = vec![0.5, -0.3, 0.0, 0.0];
        let targets = vec![2.0, -1.5, 0.0, 0.0];
        let acts = vec![1.0, 0.5, 0.0, 0.0];

        accumulate_weight_persistent_4way(0, &weights, &targets, &acts, 1e-7, 1.0, 1.0, 100000.0);

        let all = read_all_synapse_state();
        assert_eq!(all.len(), 2 * SYNAPSE_FIELDS);

        // First synapse should have data
        assert_eq!(all[0], 1.0); // count

        free_training_state();
    }

    #[test]
    fn test_out_of_bounds_index() {
        init_training_state(2, 2);

        // Reading out-of-bounds should return zeroes
        let syn = read_synapse_state(100);
        assert_eq!(syn.len(), SYNAPSE_FIELDS);
        for &v in &syn {
            assert_eq!(v, 0.0);
        }

        free_training_state();
    }

    #[test]
    fn test_8way_persistent() {
        init_training_state(8, 0);

        let weights = vec![0.5, -0.3, 1.2, 0.0, -1.0, 0.8, -0.5, 1.5];
        let targets = vec![2.0, -1.5, 0.8, 3.0, -2.0, 1.0, -0.5, 2.5];
        let acts = vec![1.0, 0.5, -0.8, 2.0, -1.5, 0.3, 0.9, -0.6];

        accumulate_weight_persistent_8way(
            0, &weights, &targets, &acts, 1e-7, 1.0, 1.0, 100000.0,
        );

        // Compare with batch
        let batch = crate::accumulate::accumulate_weight_batch_8way(
            &weights, &targets, &acts, 1e-7, 1.0, 1.0, 100000.0,
        );

        for i in 0..8 {
            let persistent = read_synapse_state(i);
            let batch_base = i * SYNAPSE_FIELDS;
            for f in 0..SYNAPSE_FIELDS {
                assert!(
                    (persistent[f] - batch[batch_base + f]).abs() < 1e-10,
                    "8way mismatch at synapse {} field {}",
                    i, f,
                );
            }
        }

        free_training_state();
    }
}

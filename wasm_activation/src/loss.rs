//! Loss function implementations for neural network batch scoring.
//!
//! This module provides fused activate + loss calculation functions that process
//! batches of records in a single WASM call. These are optimised for scoring performance
//! by minimising JS/WASM boundary crossings.
//!
//! Issue #118x, #1202, #1209 - Batch scoring optimisations.

use wasm_bindgen::prelude::*;

use crate::network::CompiledNetwork;
use crate::range::apply_limit_range;
use crate::simd::{weighted_sum_simd_4records, weighted_sum_simd_8records};
use crate::squash::{apply_squash, SquashType};
use crate::synapse_type::SynapseType;

/// Issue #1209 - Shared 8-way activation helper macro to reduce code duplication.
///
/// This macro generates the neuron activation loop for 8 records in parallel,
/// then calls a provided error calculation closure for each record.
macro_rules! batch_8way_activation {
    ($network:expr, $records:expr, $values_per_record:expr, $input_size:expr, $num_outputs:expr, $num_records:expr, $error_fn:expr) => {{
        let num_neurons = $network.num_neurons;
        let num_inputs = $network.num_inputs;
        let mut act0: Vec<f32> = vec![0.0; num_neurons];
        let mut act1: Vec<f32> = vec![0.0; num_neurons];
        let mut act2: Vec<f32> = vec![0.0; num_neurons];
        let mut act3: Vec<f32> = vec![0.0; num_neurons];
        let mut act4: Vec<f32> = vec![0.0; num_neurons];
        let mut act5: Vec<f32> = vec![0.0; num_neurons];
        let mut act6: Vec<f32> = vec![0.0; num_neurons];
        let mut act7: Vec<f32> = vec![0.0; num_neurons];

        let mut sum_error: f64 = 0.0;
        let output_start = num_neurons - $num_outputs;

        // Process in batches of 8
        let full_batches = $num_records / 8;
        for batch in 0..full_batches {
            let base_idx = batch * 8;

            // Load inputs for all 8 records
            for r in 0..8 {
                let record_idx = base_idx + r;
                let base = record_idx * $values_per_record;
                let inputs = &$records[base..base + $input_size];
                let act = match r {
                    0 => &mut act0,
                    1 => &mut act1,
                    2 => &mut act2,
                    3 => &mut act3,
                    4 => &mut act4,
                    5 => &mut act5,
                    6 => &mut act6,
                    _ => &mut act7,
                };
                act[..$input_size].copy_from_slice(inputs);
            }

            // Process each neuron for all 8 records
            for (neuron_idx, neuron) in $network.neurons.iter().enumerate() {
                let actual_idx = num_inputs + neuron_idx;

                if neuron.is_constant {
                    let val = apply_limit_range(SquashType::Identity, neuron.bias);
                    act0[actual_idx] = val;
                    act1[actual_idx] = val;
                    act2[actual_idx] = val;
                    act3[actual_idx] = val;
                    act4[actual_idx] = val;
                    act5[actual_idx] = val;
                    act6[actual_idx] = val;
                    act7[actual_idx] = val;
                } else {
                    let squash = SquashType::from(neuron.squash_type);
                    let start_synapse = neuron.start_synapse as usize;
                    let end_synapse = start_synapse + neuron.num_synapses as usize;

                    match squash {
                        SquashType::Minimum | SquashType::Maximum | SquashType::If => {
                            for (r, act) in [
                                (0, &mut act0),
                                (1, &mut act1),
                                (2, &mut act2),
                                (3, &mut act3),
                                (4, &mut act4),
                                (5, &mut act5),
                                (6, &mut act6),
                                (7, &mut act7),
                            ] {
                                let _ = r;
                                let activation = match squash {
                                    SquashType::Minimum => {
                                        let mut min_val = f32::INFINITY;
                                        for synapse_idx in start_synapse..end_synapse {
                                            let synapse = &$network.synapses[synapse_idx];
                                            let val =
                                                act[synapse.from_index as usize] * synapse.weight;
                                            if val < min_val {
                                                min_val = val;
                                            }
                                        }
                                        if min_val == f32::INFINITY {
                                            neuron.bias
                                        } else {
                                            min_val + neuron.bias
                                        }
                                    }
                                    SquashType::Maximum => {
                                        let mut max_val = f32::NEG_INFINITY;
                                        for synapse_idx in start_synapse..end_synapse {
                                            let synapse = &$network.synapses[synapse_idx];
                                            let val =
                                                act[synapse.from_index as usize] * synapse.weight;
                                            if val > max_val {
                                                max_val = val;
                                            }
                                        }
                                        if max_val == f32::NEG_INFINITY {
                                            neuron.bias
                                        } else {
                                            max_val + neuron.bias
                                        }
                                    }
                                    SquashType::If => {
                                        let mut condition_sum = 0.0f32;
                                        let mut positive_sum = 0.0f32;
                                        let mut negative_sum = 0.0f32;
                                        for synapse_idx in start_synapse..end_synapse {
                                            let synapse = &$network.synapses[synapse_idx];
                                            let val =
                                                act[synapse.from_index as usize] * synapse.weight;
                                            match SynapseType::from(synapse.synapse_type) {
                                                SynapseType::Condition => condition_sum += val,
                                                SynapseType::Negative => negative_sum += val,
                                                SynapseType::Positive | SynapseType::Standard => {
                                                    positive_sum += val
                                                }
                                            }
                                        }
                                        if condition_sum > 0.0 {
                                            positive_sum + neuron.bias
                                        } else {
                                            negative_sum + neuron.bias
                                        }
                                    }
                                    _ => unreachable!(),
                                };
                                act[actual_idx] = apply_limit_range(squash, activation);
                            }
                        }
                        _ => {
                            #[cfg(target_arch = "wasm32")]
                            let (sum0, sum1, sum2, sum3, sum4, sum5, sum6, sum7) = unsafe {
                                weighted_sum_simd_8records(
                                    &$network.synapses,
                                    &act0,
                                    &act1,
                                    &act2,
                                    &act3,
                                    &act4,
                                    &act5,
                                    &act6,
                                    &act7,
                                    start_synapse,
                                    end_synapse,
                                    neuron.bias,
                                )
                            };
                            #[cfg(not(target_arch = "wasm32"))]
                            let (sum0, sum1, sum2, sum3, sum4, sum5, sum6, sum7) =
                                weighted_sum_simd_8records(
                                    &$network.synapses,
                                    &act0,
                                    &act1,
                                    &act2,
                                    &act3,
                                    &act4,
                                    &act5,
                                    &act6,
                                    &act7,
                                    start_synapse,
                                    end_synapse,
                                    neuron.bias,
                                );

                            let apply_squash_inline = |sum: f32| -> f32 {
                                match neuron.squash_type {
                                    0 => sum,
                                    1 => sum.max(0.0),
                                    6 => 1.0 / (1.0 + (-sum).exp()),
                                    7 => sum.tanh(),
                                    _ => apply_squash(squash, sum),
                                }
                            };

                            act0[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum0));
                            act1[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum1));
                            act2[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum2));
                            act3[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum3));
                            act4[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum4));
                            act5[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum5));
                            act6[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum6));
                            act7[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum7));
                        }
                    }
                }
            }

            // Calculate error for all 8 records
            for r in 0..8 {
                let record_idx = base_idx + r;
                let target_base = record_idx * $values_per_record + $input_size;
                let act = match r {
                    0 => &act0,
                    1 => &act1,
                    2 => &act2,
                    3 => &act3,
                    4 => &act4,
                    5 => &act5,
                    6 => &act6,
                    _ => &act7,
                };
                sum_error += $error_fn($records, target_base, act, output_start, $num_outputs);
            }
        }

        // Handle remainder: use 4-way for 4-7 remaining records
        let remainder_start = full_batches * 8;
        let remaining = $num_records - remainder_start;

        if remaining >= 4 {
            let four_way_batches = remaining / 4;
            for batch in 0..four_way_batches {
                let base_idx = remainder_start + batch * 4;

                for r in 0..4 {
                    let record_idx = base_idx + r;
                    let base = record_idx * $values_per_record;
                    let inputs = &$records[base..base + $input_size];
                    let act = match r {
                        0 => &mut act0,
                        1 => &mut act1,
                        2 => &mut act2,
                        _ => &mut act3,
                    };
                    act[..$input_size].copy_from_slice(inputs);
                }

                for (neuron_idx, neuron) in $network.neurons.iter().enumerate() {
                    let actual_idx = num_inputs + neuron_idx;

                    if neuron.is_constant {
                        let val = apply_limit_range(SquashType::Identity, neuron.bias);
                        act0[actual_idx] = val;
                        act1[actual_idx] = val;
                        act2[actual_idx] = val;
                        act3[actual_idx] = val;
                    } else {
                        let squash = SquashType::from(neuron.squash_type);
                        let start_synapse = neuron.start_synapse as usize;
                        let end_synapse = start_synapse + neuron.num_synapses as usize;

                        match squash {
                            SquashType::Minimum | SquashType::Maximum | SquashType::If => {
                                for (r, act) in [
                                    (0, &mut act0),
                                    (1, &mut act1),
                                    (2, &mut act2),
                                    (3, &mut act3),
                                ] {
                                    let _ = r;
                                    let activation = match squash {
                                        SquashType::Minimum => {
                                            let mut min_val = f32::INFINITY;
                                            for synapse_idx in start_synapse..end_synapse {
                                                let synapse = &$network.synapses[synapse_idx];
                                                let val = act[synapse.from_index as usize]
                                                    * synapse.weight;
                                                if val < min_val {
                                                    min_val = val;
                                                }
                                            }
                                            if min_val == f32::INFINITY {
                                                neuron.bias
                                            } else {
                                                min_val + neuron.bias
                                            }
                                        }
                                        SquashType::Maximum => {
                                            let mut max_val = f32::NEG_INFINITY;
                                            for synapse_idx in start_synapse..end_synapse {
                                                let synapse = &$network.synapses[synapse_idx];
                                                let val = act[synapse.from_index as usize]
                                                    * synapse.weight;
                                                if val > max_val {
                                                    max_val = val;
                                                }
                                            }
                                            if max_val == f32::NEG_INFINITY {
                                                neuron.bias
                                            } else {
                                                max_val + neuron.bias
                                            }
                                        }
                                        SquashType::If => {
                                            let mut condition_sum = 0.0f32;
                                            let mut positive_sum = 0.0f32;
                                            let mut negative_sum = 0.0f32;
                                            for synapse_idx in start_synapse..end_synapse {
                                                let synapse = &$network.synapses[synapse_idx];
                                                let val = act[synapse.from_index as usize]
                                                    * synapse.weight;
                                                match SynapseType::from(synapse.synapse_type) {
                                                    SynapseType::Condition => condition_sum += val,
                                                    SynapseType::Negative => negative_sum += val,
                                                    SynapseType::Positive
                                                    | SynapseType::Standard => positive_sum += val,
                                                }
                                            }
                                            if condition_sum > 0.0 {
                                                positive_sum + neuron.bias
                                            } else {
                                                negative_sum + neuron.bias
                                            }
                                        }
                                        _ => unreachable!(),
                                    };
                                    act[actual_idx] = apply_limit_range(squash, activation);
                                }
                            }
                            _ => {
                                #[cfg(target_arch = "wasm32")]
                                let (sum0, sum1, sum2, sum3) = unsafe {
                                    weighted_sum_simd_4records(
                                        &$network.synapses,
                                        &act0,
                                        &act1,
                                        &act2,
                                        &act3,
                                        start_synapse,
                                        end_synapse,
                                        neuron.bias,
                                    )
                                };
                                #[cfg(not(target_arch = "wasm32"))]
                                let (sum0, sum1, sum2, sum3) = weighted_sum_simd_4records(
                                    &$network.synapses,
                                    &act0,
                                    &act1,
                                    &act2,
                                    &act3,
                                    start_synapse,
                                    end_synapse,
                                    neuron.bias,
                                );

                                let apply_squash_inline = |sum: f32| -> f32 {
                                    match neuron.squash_type {
                                        0 => sum,
                                        1 => sum.max(0.0),
                                        6 => 1.0 / (1.0 + (-sum).exp()),
                                        7 => sum.tanh(),
                                        _ => apply_squash(squash, sum),
                                    }
                                };

                                act0[actual_idx] =
                                    apply_limit_range(squash, apply_squash_inline(sum0));
                                act1[actual_idx] =
                                    apply_limit_range(squash, apply_squash_inline(sum1));
                                act2[actual_idx] =
                                    apply_limit_range(squash, apply_squash_inline(sum2));
                                act3[actual_idx] =
                                    apply_limit_range(squash, apply_squash_inline(sum3));
                            }
                        }
                    }
                }

                for r in 0..4 {
                    let record_idx = base_idx + r;
                    let target_base = record_idx * $values_per_record + $input_size;
                    let act = match r {
                        0 => &act0,
                        1 => &act1,
                        2 => &act2,
                        _ => &act3,
                    };
                    sum_error += $error_fn($records, target_base, act, output_start, $num_outputs);
                }
            }
        }

        // Handle final remainder with single-record processing
        let final_remainder_start = remainder_start + (remaining / 4) * 4;
        for record_idx in final_remainder_start..$num_records {
            let base = record_idx * $values_per_record;
            let inputs = &$records[base..base + $input_size];
            let target_base = base + $input_size;

            act0[..$input_size].copy_from_slice(inputs);

            for i in num_inputs..num_neurons {
                act0[i] = 0.0;
            }

            for (neuron_idx, neuron) in $network.neurons.iter().enumerate() {
                let actual_idx = num_inputs + neuron_idx;

                if neuron.is_constant {
                    act0[actual_idx] = apply_limit_range(SquashType::Identity, neuron.bias);
                } else {
                    let squash = SquashType::from(neuron.squash_type);
                    let start_synapse = neuron.start_synapse as usize;
                    let end_synapse = start_synapse + neuron.num_synapses as usize;

                    let activation = match squash {
                        SquashType::Minimum => {
                            let mut min_val = f32::INFINITY;
                            for synapse_idx in start_synapse..end_synapse {
                                let synapse = &$network.synapses[synapse_idx];
                                let val = act0[synapse.from_index as usize] * synapse.weight;
                                if val < min_val {
                                    min_val = val;
                                }
                            }
                            if min_val == f32::INFINITY {
                                neuron.bias
                            } else {
                                min_val + neuron.bias
                            }
                        }
                        SquashType::Maximum => {
                            let mut max_val = f32::NEG_INFINITY;
                            for synapse_idx in start_synapse..end_synapse {
                                let synapse = &$network.synapses[synapse_idx];
                                let val = act0[synapse.from_index as usize] * synapse.weight;
                                if val > max_val {
                                    max_val = val;
                                }
                            }
                            if max_val == f32::NEG_INFINITY {
                                neuron.bias
                            } else {
                                max_val + neuron.bias
                            }
                        }
                        SquashType::If => {
                            let mut condition_sum = 0.0f32;
                            let mut positive_sum = 0.0f32;
                            let mut negative_sum = 0.0f32;
                            for synapse_idx in start_synapse..end_synapse {
                                let synapse = &$network.synapses[synapse_idx];
                                let val = act0[synapse.from_index as usize] * synapse.weight;
                                match SynapseType::from(synapse.synapse_type) {
                                    SynapseType::Condition => condition_sum += val,
                                    SynapseType::Negative => negative_sum += val,
                                    SynapseType::Positive | SynapseType::Standard => {
                                        positive_sum += val
                                    }
                                }
                            }
                            if condition_sum > 0.0 {
                                positive_sum + neuron.bias
                            } else {
                                negative_sum + neuron.bias
                            }
                        }
                        _ => {
                            let mut sum = neuron.bias;
                            for synapse_idx in start_synapse..end_synapse {
                                let synapse = &$network.synapses[synapse_idx];
                                sum += act0[synapse.from_index as usize] * synapse.weight;
                            }
                            match neuron.squash_type {
                                0 => sum,
                                1 => sum.max(0.0),
                                6 => 1.0 / (1.0 + (-sum).exp()),
                                7 => sum.tanh(),
                                _ => apply_squash(squash, sum),
                            }
                        }
                    };
                    act0[actual_idx] = apply_limit_range(squash, activation);
                }
            }

            sum_error += $error_fn($records, target_base, &act0, output_start, $num_outputs);
        }

        sum_error
    }};
}

/// Fused activate + MSE (Mean Squared Error) calculation for batch scoring.
///
/// This is a scoring fast-path designed to minimise JS/WASM boundary crossings:
/// - Each record is laid out as: [inputs..., targets...]
/// - `input_size` must match the number of input floats in each record.
/// - `num_outputs` must match the number of target/output floats in each record.
///
/// Returns the **sum** of per-record MSE values (not averaged over records).
///
/// When `forward_only=true`, we skip clearing `network.activations` between records
/// because v4+ forward-only creatures guarantee there are no recurrent/back edges.
/// When `forward_only=false`, we must call `reset_state()` each record to preserve
/// stateless semantics (`feedbackLoop=false`) and avoid state leakage.
///
/// Issue #118x - Fuse activate + MSE for scoring performance.
/// Issue #1202 - Use 4-record SIMD batching for forward-only networks.
#[wasm_bindgen]
pub fn mse_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    let values_per_record = input_size + num_outputs;
    if values_per_record == 0 {
        return 0.0;
    }
    let num_records = records.len() / values_per_record;
    if num_records == 0 {
        return 0.0;
    }

    // Issue #1209 - Use batched 8-record SIMD path for forward-only networks
    // Falls back to 4-way for remainder handling, then single-record
    if forward_only && num_records >= 8 {
        return mse_sum_batch_8way(
            network,
            records,
            values_per_record,
            input_size,
            num_outputs,
            num_records,
        );
    }

    // Issue #1202 - Use batched 4-record SIMD path for forward-only networks
    if forward_only && num_records >= 4 {
        return mse_sum_batch_4way(
            network,
            records,
            values_per_record,
            input_size,
            num_outputs,
            num_records,
        );
    }

    let inv_outputs: f64 = if num_outputs > 0 {
        1.0 / (num_outputs as f64)
    } else {
        0.0
    };

    // Reuse a small output buffer to avoid per-record allocation.
    let mut outputs: Vec<f32> = vec![0.0; num_outputs];

    let mut sum_error: f64 = 0.0;
    for record_idx in 0..num_records {
        if !forward_only {
            // Ensure stateless behaviour for networks that may read stale activations.
            network.reset_state();
        }

        let base = record_idx * values_per_record;
        let input_start = base;
        let input_end = base + input_size;
        let target_start = input_end;
        // Activate into the reusable output buffer.
        network.activate_into(&records[input_start..input_end], &mut outputs[..]);

        // Per-record MSE = mean((target - output)^2)
        let mut sq_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let diff = (records[target_start + j] - outputs[j]) as f64;
            sq_sum += diff * diff;
        }
        sum_error += sq_sum * inv_outputs;
    }

    sum_error
}

/// Issue #1202 - Batched MSE with 4-record SIMD parallelism.
///
/// Processes 4 records simultaneously using SIMD across records.
/// This is an internal helper that only works for forward-only networks
/// with standard squash functions. Falls back to single-record for edge cases.
fn mse_sum_batch_4way(
    network: &CompiledNetwork,
    records: &[f32],
    values_per_record: usize,
    input_size: usize,
    num_outputs: usize,
    num_records: usize,
) -> f64 {
    let inv_outputs: f64 = if num_outputs > 0 {
        1.0 / (num_outputs as f64)
    } else {
        return 0.0;
    };

    // Allocate 4 activation buffers
    let num_neurons = network.num_neurons;
    let num_inputs = network.num_inputs;
    let mut act0: Vec<f32> = vec![0.0; num_neurons];
    let mut act1: Vec<f32> = vec![0.0; num_neurons];
    let mut act2: Vec<f32> = vec![0.0; num_neurons];
    let mut act3: Vec<f32> = vec![0.0; num_neurons];

    let mut sum_error: f64 = 0.0;
    let output_start = num_neurons - num_outputs;

    // Process in batches of 4
    let full_batches = num_records / 4;
    for batch in 0..full_batches {
        let base_idx = batch * 4;

        // Load inputs for all 4 records
        for r in 0..4 {
            let record_idx = base_idx + r;
            let base = record_idx * values_per_record;
            let inputs = &records[base..base + input_size];
            let act = match r {
                0 => &mut act0,
                1 => &mut act1,
                2 => &mut act2,
                _ => &mut act3,
            };
            act[..input_size].copy_from_slice(inputs);
        }

        // Process each neuron for all 4 records
        for (neuron_idx, neuron) in network.neurons.iter().enumerate() {
            let actual_idx = num_inputs + neuron_idx;

            if neuron.is_constant {
                let val = apply_limit_range(SquashType::Identity, neuron.bias);
                act0[actual_idx] = val;
                act1[actual_idx] = val;
                act2[actual_idx] = val;
                act3[actual_idx] = val;
            } else {
                let squash = SquashType::from(neuron.squash_type);
                let start_synapse = neuron.start_synapse as usize;
                let end_synapse = start_synapse + neuron.num_synapses as usize;

                // Only use batched path for standard squash functions
                match squash {
                    SquashType::Minimum | SquashType::Maximum | SquashType::If => {
                        // Fall back to scalar for special squash functions
                        for (r, act) in [
                            (0, &mut act0),
                            (1, &mut act1),
                            (2, &mut act2),
                            (3, &mut act3),
                        ] {
                            let _ = r;
                            let activation = match squash {
                                SquashType::Minimum => {
                                    let mut min_val = f32::INFINITY;
                                    for synapse_idx in start_synapse..end_synapse {
                                        let synapse = &network.synapses[synapse_idx];
                                        let val = act[synapse.from_index as usize] * synapse.weight;
                                        if val < min_val {
                                            min_val = val;
                                        }
                                    }
                                    if min_val == f32::INFINITY {
                                        neuron.bias
                                    } else {
                                        min_val + neuron.bias
                                    }
                                }
                                SquashType::Maximum => {
                                    let mut max_val = f32::NEG_INFINITY;
                                    for synapse_idx in start_synapse..end_synapse {
                                        let synapse = &network.synapses[synapse_idx];
                                        let val = act[synapse.from_index as usize] * synapse.weight;
                                        if val > max_val {
                                            max_val = val;
                                        }
                                    }
                                    if max_val == f32::NEG_INFINITY {
                                        neuron.bias
                                    } else {
                                        max_val + neuron.bias
                                    }
                                }
                                SquashType::If => {
                                    let mut condition_sum = 0.0f32;
                                    let mut positive_sum = 0.0f32;
                                    let mut negative_sum = 0.0f32;
                                    for synapse_idx in start_synapse..end_synapse {
                                        let synapse = &network.synapses[synapse_idx];
                                        let val = act[synapse.from_index as usize] * synapse.weight;
                                        match SynapseType::from(synapse.synapse_type) {
                                            SynapseType::Condition => condition_sum += val,
                                            SynapseType::Negative => negative_sum += val,
                                            SynapseType::Positive | SynapseType::Standard => {
                                                positive_sum += val
                                            }
                                        }
                                    }
                                    if condition_sum > 0.0 {
                                        positive_sum + neuron.bias
                                    } else {
                                        negative_sum + neuron.bias
                                    }
                                }
                                _ => unreachable!(),
                            };
                            act[actual_idx] = apply_limit_range(squash, activation);
                        }
                    }
                    _ => {
                        // Use SIMD for standard squash functions
                        #[cfg(target_arch = "wasm32")]
                        let (sum0, sum1, sum2, sum3) = unsafe {
                            weighted_sum_simd_4records(
                                &network.synapses,
                                &act0,
                                &act1,
                                &act2,
                                &act3,
                                start_synapse,
                                end_synapse,
                                neuron.bias,
                            )
                        };
                        #[cfg(not(target_arch = "wasm32"))]
                        let (sum0, sum1, sum2, sum3) = weighted_sum_simd_4records(
                            &network.synapses,
                            &act0,
                            &act1,
                            &act2,
                            &act3,
                            start_synapse,
                            end_synapse,
                            neuron.bias,
                        );

                        // Apply squash to all 4 records
                        let apply_squash_inline = |sum: f32| -> f32 {
                            match neuron.squash_type {
                                0 => sum,                        // IDENTITY
                                1 => sum.max(0.0),               // ReLU
                                6 => 1.0 / (1.0 + (-sum).exp()), // LOGISTIC
                                7 => sum.tanh(),                 // TANH
                                _ => apply_squash(squash, sum),  // Other
                            }
                        };

                        act0[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum0));
                        act1[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum1));
                        act2[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum2));
                        act3[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum3));
                    }
                }
            }
        }

        // Calculate MSE for all 4 records
        for r in 0..4 {
            let record_idx = base_idx + r;
            let target_base = record_idx * values_per_record + input_size;
            let act = match r {
                0 => &act0,
                1 => &act1,
                2 => &act2,
                _ => &act3,
            };

            let mut sq_sum: f64 = 0.0;
            for j in 0..num_outputs {
                let diff = (records[target_base + j] - act[output_start + j]) as f64;
                sq_sum += diff * diff;
            }
            sum_error += sq_sum * inv_outputs;
        }
    }

    // Handle remainder with single-record processing
    let remainder_start = full_batches * 4;
    for record_idx in remainder_start..num_records {
        let base = record_idx * values_per_record;
        let inputs = &records[base..base + input_size];
        let target_base = base + input_size;

        // Reuse act0 for single record
        act0[..input_size].copy_from_slice(inputs);

        // Reset non-input activations
        for activation in act0.iter_mut().take(num_neurons).skip(num_inputs) {
            *activation = 0.0;
        }

        // Process each neuron
        for (neuron_idx, neuron) in network.neurons.iter().enumerate() {
            let actual_idx = num_inputs + neuron_idx;

            if neuron.is_constant {
                act0[actual_idx] = apply_limit_range(SquashType::Identity, neuron.bias);
            } else {
                let squash = SquashType::from(neuron.squash_type);
                let start_synapse = neuron.start_synapse as usize;
                let end_synapse = start_synapse + neuron.num_synapses as usize;

                let activation = match squash {
                    SquashType::Minimum => {
                        let mut min_val = f32::INFINITY;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &network.synapses[synapse_idx];
                            let val = act0[synapse.from_index as usize] * synapse.weight;
                            if val < min_val {
                                min_val = val;
                            }
                        }
                        if min_val == f32::INFINITY {
                            neuron.bias
                        } else {
                            min_val + neuron.bias
                        }
                    }
                    SquashType::Maximum => {
                        let mut max_val = f32::NEG_INFINITY;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &network.synapses[synapse_idx];
                            let val = act0[synapse.from_index as usize] * synapse.weight;
                            if val > max_val {
                                max_val = val;
                            }
                        }
                        if max_val == f32::NEG_INFINITY {
                            neuron.bias
                        } else {
                            max_val + neuron.bias
                        }
                    }
                    SquashType::If => {
                        let mut condition_sum = 0.0f32;
                        let mut positive_sum = 0.0f32;
                        let mut negative_sum = 0.0f32;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &network.synapses[synapse_idx];
                            let val = act0[synapse.from_index as usize] * synapse.weight;
                            match SynapseType::from(synapse.synapse_type) {
                                SynapseType::Condition => condition_sum += val,
                                SynapseType::Negative => negative_sum += val,
                                SynapseType::Positive | SynapseType::Standard => {
                                    positive_sum += val
                                }
                            }
                        }
                        if condition_sum > 0.0 {
                            positive_sum + neuron.bias
                        } else {
                            negative_sum + neuron.bias
                        }
                    }
                    _ => {
                        let mut sum = neuron.bias;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &network.synapses[synapse_idx];
                            sum += act0[synapse.from_index as usize] * synapse.weight;
                        }
                        match neuron.squash_type {
                            0 => sum,
                            1 => sum.max(0.0),
                            6 => 1.0 / (1.0 + (-sum).exp()),
                            7 => sum.tanh(),
                            _ => apply_squash(squash, sum),
                        }
                    }
                };
                act0[actual_idx] = apply_limit_range(squash, activation);
            }
        }

        // Calculate MSE
        let mut sq_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let diff = (records[target_base + j] - act0[output_start + j]) as f64;
            sq_sum += diff * diff;
        }
        sum_error += sq_sum * inv_outputs;
    }

    sum_error
}

/// Issue #1209 - Batched MSE with 8-record SIMD parallelism.
///
/// Processes 8 records simultaneously using two SIMD vectors across records.
/// This is an internal helper that only works for forward-only networks
/// with standard squash functions. Falls back to 4-way for remainder < 8,
/// then single-record for remainder < 4.
fn mse_sum_batch_8way(
    network: &CompiledNetwork,
    records: &[f32],
    values_per_record: usize,
    input_size: usize,
    num_outputs: usize,
    num_records: usize,
) -> f64 {
    let inv_outputs: f64 = if num_outputs > 0 {
        1.0 / (num_outputs as f64)
    } else {
        return 0.0;
    };

    // Allocate 8 activation buffers
    let num_neurons = network.num_neurons;
    let num_inputs = network.num_inputs;
    let mut act0: Vec<f32> = vec![0.0; num_neurons];
    let mut act1: Vec<f32> = vec![0.0; num_neurons];
    let mut act2: Vec<f32> = vec![0.0; num_neurons];
    let mut act3: Vec<f32> = vec![0.0; num_neurons];
    let mut act4: Vec<f32> = vec![0.0; num_neurons];
    let mut act5: Vec<f32> = vec![0.0; num_neurons];
    let mut act6: Vec<f32> = vec![0.0; num_neurons];
    let mut act7: Vec<f32> = vec![0.0; num_neurons];

    let mut sum_error: f64 = 0.0;
    let output_start = num_neurons - num_outputs;

    // Process in batches of 8
    let full_batches = num_records / 8;
    for batch in 0..full_batches {
        let base_idx = batch * 8;

        // Load inputs for all 8 records
        for r in 0..8 {
            let record_idx = base_idx + r;
            let base = record_idx * values_per_record;
            let inputs = &records[base..base + input_size];
            let act = match r {
                0 => &mut act0,
                1 => &mut act1,
                2 => &mut act2,
                3 => &mut act3,
                4 => &mut act4,
                5 => &mut act5,
                6 => &mut act6,
                _ => &mut act7,
            };
            act[..input_size].copy_from_slice(inputs);
        }

        // Process each neuron for all 8 records
        for (neuron_idx, neuron) in network.neurons.iter().enumerate() {
            let actual_idx = num_inputs + neuron_idx;

            if neuron.is_constant {
                let val = apply_limit_range(SquashType::Identity, neuron.bias);
                act0[actual_idx] = val;
                act1[actual_idx] = val;
                act2[actual_idx] = val;
                act3[actual_idx] = val;
                act4[actual_idx] = val;
                act5[actual_idx] = val;
                act6[actual_idx] = val;
                act7[actual_idx] = val;
            } else {
                let squash = SquashType::from(neuron.squash_type);
                let start_synapse = neuron.start_synapse as usize;
                let end_synapse = start_synapse + neuron.num_synapses as usize;

                // Only use batched path for standard squash functions
                match squash {
                    SquashType::Minimum | SquashType::Maximum | SquashType::If => {
                        // Fall back to scalar for special squash functions
                        for (r, act) in [
                            (0, &mut act0),
                            (1, &mut act1),
                            (2, &mut act2),
                            (3, &mut act3),
                            (4, &mut act4),
                            (5, &mut act5),
                            (6, &mut act6),
                            (7, &mut act7),
                        ] {
                            let _ = r;
                            let activation = match squash {
                                SquashType::Minimum => {
                                    let mut min_val = f32::INFINITY;
                                    for synapse_idx in start_synapse..end_synapse {
                                        let synapse = &network.synapses[synapse_idx];
                                        let val = act[synapse.from_index as usize] * synapse.weight;
                                        if val < min_val {
                                            min_val = val;
                                        }
                                    }
                                    if min_val == f32::INFINITY {
                                        neuron.bias
                                    } else {
                                        min_val + neuron.bias
                                    }
                                }
                                SquashType::Maximum => {
                                    let mut max_val = f32::NEG_INFINITY;
                                    for synapse_idx in start_synapse..end_synapse {
                                        let synapse = &network.synapses[synapse_idx];
                                        let val = act[synapse.from_index as usize] * synapse.weight;
                                        if val > max_val {
                                            max_val = val;
                                        }
                                    }
                                    if max_val == f32::NEG_INFINITY {
                                        neuron.bias
                                    } else {
                                        max_val + neuron.bias
                                    }
                                }
                                SquashType::If => {
                                    let mut condition_sum = 0.0f32;
                                    let mut positive_sum = 0.0f32;
                                    let mut negative_sum = 0.0f32;
                                    for synapse_idx in start_synapse..end_synapse {
                                        let synapse = &network.synapses[synapse_idx];
                                        let val = act[synapse.from_index as usize] * synapse.weight;
                                        match SynapseType::from(synapse.synapse_type) {
                                            SynapseType::Condition => condition_sum += val,
                                            SynapseType::Negative => negative_sum += val,
                                            SynapseType::Positive | SynapseType::Standard => {
                                                positive_sum += val
                                            }
                                        }
                                    }
                                    if condition_sum > 0.0 {
                                        positive_sum + neuron.bias
                                    } else {
                                        negative_sum + neuron.bias
                                    }
                                }
                                _ => unreachable!(),
                            };
                            act[actual_idx] = apply_limit_range(squash, activation);
                        }
                    }
                    _ => {
                        // Use SIMD for standard squash functions
                        #[cfg(target_arch = "wasm32")]
                        let (sum0, sum1, sum2, sum3, sum4, sum5, sum6, sum7) = unsafe {
                            weighted_sum_simd_8records(
                                &network.synapses,
                                &act0,
                                &act1,
                                &act2,
                                &act3,
                                &act4,
                                &act5,
                                &act6,
                                &act7,
                                start_synapse,
                                end_synapse,
                                neuron.bias,
                            )
                        };
                        #[cfg(not(target_arch = "wasm32"))]
                        let (sum0, sum1, sum2, sum3, sum4, sum5, sum6, sum7) =
                            weighted_sum_simd_8records(
                                &network.synapses,
                                &act0,
                                &act1,
                                &act2,
                                &act3,
                                &act4,
                                &act5,
                                &act6,
                                &act7,
                                start_synapse,
                                end_synapse,
                                neuron.bias,
                            );

                        // Apply squash to all 8 records
                        let apply_squash_inline = |sum: f32| -> f32 {
                            match neuron.squash_type {
                                0 => sum,                        // IDENTITY
                                1 => sum.max(0.0),               // ReLU
                                6 => 1.0 / (1.0 + (-sum).exp()), // LOGISTIC
                                7 => sum.tanh(),                 // TANH
                                _ => apply_squash(squash, sum),  // Other
                            }
                        };

                        act0[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum0));
                        act1[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum1));
                        act2[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum2));
                        act3[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum3));
                        act4[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum4));
                        act5[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum5));
                        act6[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum6));
                        act7[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum7));
                    }
                }
            }
        }

        // Calculate MSE for all 8 records
        for r in 0..8 {
            let record_idx = base_idx + r;
            let target_base = record_idx * values_per_record + input_size;
            let act = match r {
                0 => &act0,
                1 => &act1,
                2 => &act2,
                3 => &act3,
                4 => &act4,
                5 => &act5,
                6 => &act6,
                _ => &act7,
            };

            let mut sq_sum: f64 = 0.0;
            for j in 0..num_outputs {
                let diff = (records[target_base + j] - act[output_start + j]) as f64;
                sq_sum += diff * diff;
            }
            sum_error += sq_sum * inv_outputs;
        }
    }

    // Handle remainder: use 4-way for 4-7 remaining records
    let remainder_start = full_batches * 8;
    let remaining = num_records - remainder_start;

    if remaining >= 4 {
        // Process 4 records at a time
        let four_way_batches = remaining / 4;
        for batch in 0..four_way_batches {
            let base_idx = remainder_start + batch * 4;

            // Load inputs for 4 records
            for r in 0..4 {
                let record_idx = base_idx + r;
                let base = record_idx * values_per_record;
                let inputs = &records[base..base + input_size];
                let act = match r {
                    0 => &mut act0,
                    1 => &mut act1,
                    2 => &mut act2,
                    _ => &mut act3,
                };
                act[..input_size].copy_from_slice(inputs);
            }

            // Process each neuron for all 4 records
            for (neuron_idx, neuron) in network.neurons.iter().enumerate() {
                let actual_idx = num_inputs + neuron_idx;

                if neuron.is_constant {
                    let val = apply_limit_range(SquashType::Identity, neuron.bias);
                    act0[actual_idx] = val;
                    act1[actual_idx] = val;
                    act2[actual_idx] = val;
                    act3[actual_idx] = val;
                } else {
                    let squash = SquashType::from(neuron.squash_type);
                    let start_synapse = neuron.start_synapse as usize;
                    let end_synapse = start_synapse + neuron.num_synapses as usize;

                    match squash {
                        SquashType::Minimum | SquashType::Maximum | SquashType::If => {
                            for (r, act) in [
                                (0, &mut act0),
                                (1, &mut act1),
                                (2, &mut act2),
                                (3, &mut act3),
                            ] {
                                let _ = r;
                                let activation = match squash {
                                    SquashType::Minimum => {
                                        let mut min_val = f32::INFINITY;
                                        for synapse_idx in start_synapse..end_synapse {
                                            let synapse = &network.synapses[synapse_idx];
                                            let val =
                                                act[synapse.from_index as usize] * synapse.weight;
                                            if val < min_val {
                                                min_val = val;
                                            }
                                        }
                                        if min_val == f32::INFINITY {
                                            neuron.bias
                                        } else {
                                            min_val + neuron.bias
                                        }
                                    }
                                    SquashType::Maximum => {
                                        let mut max_val = f32::NEG_INFINITY;
                                        for synapse_idx in start_synapse..end_synapse {
                                            let synapse = &network.synapses[synapse_idx];
                                            let val =
                                                act[synapse.from_index as usize] * synapse.weight;
                                            if val > max_val {
                                                max_val = val;
                                            }
                                        }
                                        if max_val == f32::NEG_INFINITY {
                                            neuron.bias
                                        } else {
                                            max_val + neuron.bias
                                        }
                                    }
                                    SquashType::If => {
                                        let mut condition_sum = 0.0f32;
                                        let mut positive_sum = 0.0f32;
                                        let mut negative_sum = 0.0f32;
                                        for synapse_idx in start_synapse..end_synapse {
                                            let synapse = &network.synapses[synapse_idx];
                                            let val =
                                                act[synapse.from_index as usize] * synapse.weight;
                                            match SynapseType::from(synapse.synapse_type) {
                                                SynapseType::Condition => condition_sum += val,
                                                SynapseType::Negative => negative_sum += val,
                                                SynapseType::Positive | SynapseType::Standard => {
                                                    positive_sum += val
                                                }
                                            }
                                        }
                                        if condition_sum > 0.0 {
                                            positive_sum + neuron.bias
                                        } else {
                                            negative_sum + neuron.bias
                                        }
                                    }
                                    _ => unreachable!(),
                                };
                                act[actual_idx] = apply_limit_range(squash, activation);
                            }
                        }
                        _ => {
                            #[cfg(target_arch = "wasm32")]
                            let (sum0, sum1, sum2, sum3) = unsafe {
                                weighted_sum_simd_4records(
                                    &network.synapses,
                                    &act0,
                                    &act1,
                                    &act2,
                                    &act3,
                                    start_synapse,
                                    end_synapse,
                                    neuron.bias,
                                )
                            };
                            #[cfg(not(target_arch = "wasm32"))]
                            let (sum0, sum1, sum2, sum3) = weighted_sum_simd_4records(
                                &network.synapses,
                                &act0,
                                &act1,
                                &act2,
                                &act3,
                                start_synapse,
                                end_synapse,
                                neuron.bias,
                            );

                            let apply_squash_inline = |sum: f32| -> f32 {
                                match neuron.squash_type {
                                    0 => sum,
                                    1 => sum.max(0.0),
                                    6 => 1.0 / (1.0 + (-sum).exp()),
                                    7 => sum.tanh(),
                                    _ => apply_squash(squash, sum),
                                }
                            };

                            act0[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum0));
                            act1[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum1));
                            act2[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum2));
                            act3[actual_idx] = apply_limit_range(squash, apply_squash_inline(sum3));
                        }
                    }
                }
            }

            // Calculate MSE for 4 records
            for r in 0..4 {
                let record_idx = base_idx + r;
                let target_base = record_idx * values_per_record + input_size;
                let act = match r {
                    0 => &act0,
                    1 => &act1,
                    2 => &act2,
                    _ => &act3,
                };

                let mut sq_sum: f64 = 0.0;
                for j in 0..num_outputs {
                    let diff = (records[target_base + j] - act[output_start + j]) as f64;
                    sq_sum += diff * diff;
                }
                sum_error += sq_sum * inv_outputs;
            }
        }
    }

    // Handle final remainder with single-record processing
    let final_remainder_start = remainder_start + (remaining / 4) * 4;
    for record_idx in final_remainder_start..num_records {
        let base = record_idx * values_per_record;
        let inputs = &records[base..base + input_size];
        let target_base = base + input_size;

        // Reuse act0 for single record
        act0[..input_size].copy_from_slice(inputs);

        // Reset non-input activations
        for activation in act0.iter_mut().take(num_neurons).skip(num_inputs) {
            *activation = 0.0;
        }

        // Process each neuron
        for (neuron_idx, neuron) in network.neurons.iter().enumerate() {
            let actual_idx = num_inputs + neuron_idx;

            if neuron.is_constant {
                act0[actual_idx] = apply_limit_range(SquashType::Identity, neuron.bias);
            } else {
                let squash = SquashType::from(neuron.squash_type);
                let start_synapse = neuron.start_synapse as usize;
                let end_synapse = start_synapse + neuron.num_synapses as usize;

                let activation = match squash {
                    SquashType::Minimum => {
                        let mut min_val = f32::INFINITY;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &network.synapses[synapse_idx];
                            let val = act0[synapse.from_index as usize] * synapse.weight;
                            if val < min_val {
                                min_val = val;
                            }
                        }
                        if min_val == f32::INFINITY {
                            neuron.bias
                        } else {
                            min_val + neuron.bias
                        }
                    }
                    SquashType::Maximum => {
                        let mut max_val = f32::NEG_INFINITY;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &network.synapses[synapse_idx];
                            let val = act0[synapse.from_index as usize] * synapse.weight;
                            if val > max_val {
                                max_val = val;
                            }
                        }
                        if max_val == f32::NEG_INFINITY {
                            neuron.bias
                        } else {
                            max_val + neuron.bias
                        }
                    }
                    SquashType::If => {
                        let mut condition_sum = 0.0f32;
                        let mut positive_sum = 0.0f32;
                        let mut negative_sum = 0.0f32;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &network.synapses[synapse_idx];
                            let val = act0[synapse.from_index as usize] * synapse.weight;
                            match SynapseType::from(synapse.synapse_type) {
                                SynapseType::Condition => condition_sum += val,
                                SynapseType::Negative => negative_sum += val,
                                SynapseType::Positive | SynapseType::Standard => {
                                    positive_sum += val
                                }
                            }
                        }
                        if condition_sum > 0.0 {
                            positive_sum + neuron.bias
                        } else {
                            negative_sum + neuron.bias
                        }
                    }
                    _ => {
                        let mut sum = neuron.bias;
                        for synapse_idx in start_synapse..end_synapse {
                            let synapse = &network.synapses[synapse_idx];
                            sum += act0[synapse.from_index as usize] * synapse.weight;
                        }
                        match neuron.squash_type {
                            0 => sum,
                            1 => sum.max(0.0),
                            6 => 1.0 / (1.0 + (-sum).exp()),
                            7 => sum.tanh(),
                            _ => apply_squash(squash, sum),
                        }
                    }
                };
                act0[actual_idx] = apply_limit_range(squash, activation);
            }
        }

        // Calculate MSE
        let mut sq_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let diff = (records[target_base + j] - act0[output_start + j]) as f64;
            sq_sum += diff * diff;
        }
        sum_error += sq_sum * inv_outputs;
    }

    sum_error
}

/// Issue #1209 - Batched MAE with 8-record SIMD parallelism.
fn mae_sum_batch_8way(
    network: &CompiledNetwork,
    records: &[f32],
    values_per_record: usize,
    input_size: usize,
    num_outputs: usize,
    num_records: usize,
) -> f64 {
    let inv_outputs: f64 = if num_outputs > 0 {
        1.0 / (num_outputs as f64)
    } else {
        return 0.0;
    };

    // MAE error calculation: mean(|target - output|)
    let mae_error = |records: &[f32],
                     target_base: usize,
                     act: &[f32],
                     output_start: usize,
                     num_outputs: usize|
     -> f64 {
        let mut abs_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let diff = (records[target_base + j] - act[output_start + j]) as f64;
            abs_sum += diff.abs();
        }
        abs_sum * inv_outputs
    };

    batch_8way_activation!(
        network,
        records,
        values_per_record,
        input_size,
        num_outputs,
        num_records,
        mae_error
    )
}

/// Issue #1209 - Batched Cross-Entropy with 8-record SIMD parallelism.
fn cross_entropy_sum_batch_8way(
    network: &CompiledNetwork,
    records: &[f32],
    values_per_record: usize,
    input_size: usize,
    num_outputs: usize,
    num_records: usize,
) -> f64 {
    let inv_outputs: f64 = if num_outputs > 0 {
        1.0 / (num_outputs as f64)
    } else {
        return 0.0;
    };

    const EPSILON: f64 = 1e-15;

    // Cross-Entropy error calculation: -(1/n) * Σ(t * log(o) + (1-t) * log(1-o))
    let ce_error = |records: &[f32],
                    target_base: usize,
                    act: &[f32],
                    output_start: usize,
                    num_outputs: usize|
     -> f64 {
        let mut ce_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let t = records[target_base + j] as f64;
            let o_raw = act[output_start + j] as f64;
            let o = o_raw.clamp(EPSILON, 1.0 - EPSILON);
            ce_sum -= t * o.ln() + (1.0 - t) * (1.0 - o).ln();
        }
        ce_sum * inv_outputs
    };

    batch_8way_activation!(
        network,
        records,
        values_per_record,
        input_size,
        num_outputs,
        num_records,
        ce_error
    )
}

/// Issue #1209 - Batched MAPE with 8-record SIMD parallelism.
fn mape_sum_batch_8way(
    network: &CompiledNetwork,
    records: &[f32],
    values_per_record: usize,
    input_size: usize,
    num_outputs: usize,
    num_records: usize,
) -> f64 {
    let inv_outputs: f64 = if num_outputs > 0 {
        1.0 / (num_outputs as f64)
    } else {
        return 0.0;
    };

    const EPSILON: f64 = 1e-15;

    // MAPE error calculation: (1/n) * Σ|(output - target) / max(target, ε)|
    let mape_error = |records: &[f32],
                      target_base: usize,
                      act: &[f32],
                      output_start: usize,
                      num_outputs: usize|
     -> f64 {
        let mut mape_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let t = (records[target_base + j] as f64).max(EPSILON);
            let o = act[output_start + j] as f64;
            mape_sum += ((o - t) / t).abs();
        }
        mape_sum * inv_outputs
    };

    batch_8way_activation!(
        network,
        records,
        values_per_record,
        input_size,
        num_outputs,
        num_records,
        mape_error
    )
}

/// Issue #1209 - Batched MSLE with 8-record SIMD parallelism.
fn msle_sum_batch_8way(
    network: &CompiledNetwork,
    records: &[f32],
    values_per_record: usize,
    input_size: usize,
    num_outputs: usize,
    num_records: usize,
) -> f64 {
    if num_outputs == 0 {
        return 0.0;
    }

    const EPSILON: f64 = 1e-15;

    // MSLE error calculation: Σ(log(max(target, ε)) - log(max(output, ε)))
    // Note: No averaging per record to match JS implementation
    let msle_error = |records: &[f32],
                      target_base: usize,
                      act: &[f32],
                      output_start: usize,
                      num_outputs: usize|
     -> f64 {
        let mut msle_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let t = (records[target_base + j] as f64).max(EPSILON);
            let o = (act[output_start + j] as f64).max(EPSILON);
            msle_sum += t.ln() - o.ln();
        }
        msle_sum
    };

    batch_8way_activation!(
        network,
        records,
        values_per_record,
        input_size,
        num_outputs,
        num_records,
        msle_error
    )
}

/// Issue #1209 - Batched Hinge with 8-record SIMD parallelism.
fn hinge_sum_batch_8way(
    network: &CompiledNetwork,
    records: &[f32],
    values_per_record: usize,
    input_size: usize,
    num_outputs: usize,
    num_records: usize,
) -> f64 {
    if num_outputs == 0 {
        return 0.0;
    }

    // Hinge error calculation: Σmax(0, 1 - target * output)
    // Note: No averaging per record to match JS implementation
    let hinge_error = |records: &[f32],
                       target_base: usize,
                       act: &[f32],
                       output_start: usize,
                       num_outputs: usize|
     -> f64 {
        let mut hinge_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let t = records[target_base + j] as f64;
            let o = act[output_start + j] as f64;
            hinge_sum += (1.0 - t * o).max(0.0);
        }
        hinge_sum
    };

    batch_8way_activation!(
        network,
        records,
        values_per_record,
        input_size,
        num_outputs,
        num_records,
        hinge_error
    )
}

/// Fused activate + MAE (Mean Absolute Error) calculation for batch scoring.
///
/// Like `mse_sum_batch_packed`, this processes a batch of `[inputs..., targets...]` records
/// in a single WASM call, returning the sum of per-record MAE errors.
///
/// MAE formula per record: (1/n) * Σ|target - output|
///
/// # Arguments
/// * `network` - The compiled network to activate
/// * `records` - Packed array of `[inputs..., targets...]` records
/// * `input_size` - Number of inputs per record
/// * `num_outputs` - Number of outputs per record
/// * `forward_only` - If true, skip reset_state() (for forward-only networks)
///
/// # Returns
/// Sum of per-record MAE errors (divide by record count for mean)
#[wasm_bindgen]
pub fn mae_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    let values_per_record = input_size + num_outputs;
    if values_per_record == 0 {
        return 0.0;
    }
    let num_records = records.len() / values_per_record;
    if num_records == 0 {
        return 0.0;
    }

    // Issue #1209 - Use batched 8-record SIMD path for forward-only networks
    if forward_only && num_records >= 8 {
        return mae_sum_batch_8way(
            network,
            records,
            values_per_record,
            input_size,
            num_outputs,
            num_records,
        );
    }

    let inv_outputs: f64 = if num_outputs > 0 {
        1.0 / (num_outputs as f64)
    } else {
        0.0
    };

    let mut outputs: Vec<f32> = vec![0.0; num_outputs];
    let mut sum_error: f64 = 0.0;

    for record_idx in 0..num_records {
        if !forward_only {
            network.reset_state();
        }

        let base = record_idx * values_per_record;
        let input_start = base;
        let input_end = base + input_size;
        let target_start = input_end;

        network.activate_into(&records[input_start..input_end], &mut outputs[..]);

        // Per-record MAE = mean(|target - output|)
        let mut abs_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let diff = (records[target_start + j] - outputs[j]) as f64;
            abs_sum += diff.abs();
        }
        sum_error += abs_sum * inv_outputs;
    }

    sum_error
}

/// Fused activate + Cross Entropy calculation for batch scoring.
///
/// Cross Entropy formula per record: -(1/n) * Σ(t * log(o) + (1-t) * log(1-o))
/// Output values are clamped to [1e-15, 1-1e-15] to prevent log(0).
///
/// # Arguments
/// * `network` - The compiled network to activate
/// * `records` - Packed array of `[inputs..., targets...]` records
/// * `input_size` - Number of inputs per record
/// * `num_outputs` - Number of outputs per record
/// * `forward_only` - If true, skip reset_state() (for forward-only networks)
///
/// # Returns
/// Sum of per-record Cross Entropy errors (divide by record count for mean)
#[wasm_bindgen]
pub fn cross_entropy_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    let values_per_record = input_size + num_outputs;
    if values_per_record == 0 {
        return 0.0;
    }
    let num_records = records.len() / values_per_record;
    if num_records == 0 {
        return 0.0;
    }

    // Issue #1209 - Use batched 8-record SIMD path for forward-only networks
    if forward_only && num_records >= 8 {
        return cross_entropy_sum_batch_8way(
            network,
            records,
            values_per_record,
            input_size,
            num_outputs,
            num_records,
        );
    }

    let inv_outputs: f64 = if num_outputs > 0 {
        1.0 / (num_outputs as f64)
    } else {
        0.0
    };

    const EPSILON: f64 = 1e-15;
    let mut outputs: Vec<f32> = vec![0.0; num_outputs];
    let mut sum_error: f64 = 0.0;

    for record_idx in 0..num_records {
        if !forward_only {
            network.reset_state();
        }

        let base = record_idx * values_per_record;
        let input_start = base;
        let input_end = base + input_size;
        let target_start = input_end;

        network.activate_into(&records[input_start..input_end], &mut outputs[..]);

        // Per-record Cross Entropy = -(1/n) * Σ(t * log(o) + (1-t) * log(1-o))
        let mut ce_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let t = records[target_start + j] as f64;
            let o_raw = outputs[j] as f64;
            // Clamp to [epsilon, 1-epsilon] to prevent log(0)
            let o = o_raw.clamp(EPSILON, 1.0 - EPSILON);
            ce_sum -= t * o.ln() + (1.0 - t) * (1.0 - o).ln();
        }
        sum_error += ce_sum * inv_outputs;
    }

    sum_error
}

/// Fused activate + MAPE (Mean Absolute Percentage Error) calculation for batch scoring.
///
/// MAPE formula per record: (1/n) * Σ|(output - target) / max(target, ε)|
///
/// # Arguments
/// * `network` - The compiled network to activate
/// * `records` - Packed array of `[inputs..., targets...]` records
/// * `input_size` - Number of inputs per record
/// * `num_outputs` - Number of outputs per record
/// * `forward_only` - If true, skip reset_state() (for forward-only networks)
///
/// # Returns
/// Sum of per-record MAPE errors (divide by record count for mean)
#[wasm_bindgen]
pub fn mape_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    let values_per_record = input_size + num_outputs;
    if values_per_record == 0 {
        return 0.0;
    }
    let num_records = records.len() / values_per_record;
    if num_records == 0 {
        return 0.0;
    }

    // Issue #1209 - Use batched 8-record SIMD path for forward-only networks
    if forward_only && num_records >= 8 {
        return mape_sum_batch_8way(
            network,
            records,
            values_per_record,
            input_size,
            num_outputs,
            num_records,
        );
    }

    let inv_outputs: f64 = if num_outputs > 0 {
        1.0 / (num_outputs as f64)
    } else {
        0.0
    };

    const EPSILON: f64 = 1e-15;
    let mut outputs: Vec<f32> = vec![0.0; num_outputs];
    let mut sum_error: f64 = 0.0;

    for record_idx in 0..num_records {
        if !forward_only {
            network.reset_state();
        }

        let base = record_idx * values_per_record;
        let input_start = base;
        let input_end = base + input_size;
        let target_start = input_end;

        network.activate_into(&records[input_start..input_end], &mut outputs[..]);

        // Per-record MAPE = (1/n) * Σ|(output - target) / max(target, ε)|
        let mut mape_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let t = (records[target_start + j] as f64).max(EPSILON);
            let o = outputs[j] as f64;
            mape_sum += ((o - t) / t).abs();
        }
        sum_error += mape_sum * inv_outputs;
    }

    sum_error
}

/// Fused activate + MSLE (Mean Squared Logarithmic Error) calculation for batch scoring.
///
/// MSLE formula per record: Σ(log(max(target, ε)) - log(max(output, ε)))
/// Note: Unlike MSE/MAE, MSLE does NOT divide by number of outputs per record.
///
/// # Arguments
/// * `network` - The compiled network to activate
/// * `records` - Packed array of `[inputs..., targets...]` records
/// * `input_size` - Number of inputs per record
/// * `num_outputs` - Number of outputs per record
/// * `forward_only` - If true, skip reset_state() (for forward-only networks)
///
/// # Returns
/// Sum of per-record MSLE errors (divide by record count for mean)
#[wasm_bindgen]
pub fn msle_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    let values_per_record = input_size + num_outputs;
    if values_per_record == 0 {
        return 0.0;
    }
    let num_records = records.len() / values_per_record;
    if num_records == 0 {
        return 0.0;
    }

    // Issue #1209 - Use batched 8-record SIMD path for forward-only networks
    if forward_only && num_records >= 8 {
        return msle_sum_batch_8way(
            network,
            records,
            values_per_record,
            input_size,
            num_outputs,
            num_records,
        );
    }

    const EPSILON: f64 = 1e-15;
    let mut outputs: Vec<f32> = vec![0.0; num_outputs];
    let mut sum_error: f64 = 0.0;

    for record_idx in 0..num_records {
        if !forward_only {
            network.reset_state();
        }

        let base = record_idx * values_per_record;
        let input_start = base;
        let input_end = base + input_size;
        let target_start = input_end;

        network.activate_into(&records[input_start..input_end], &mut outputs[..]);

        // Per-record MSLE = Σ(log(max(target, ε)) - log(max(output, ε)))
        // Note: No averaging per record to match JS implementation
        let mut msle_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let t = (records[target_start + j] as f64).max(EPSILON);
            let o = (outputs[j] as f64).max(EPSILON);
            msle_sum += t.ln() - o.ln();
        }
        sum_error += msle_sum;
    }

    sum_error
}

/// Fused activate + Hinge Loss calculation for batch scoring.
///
/// Hinge formula per record: Σmax(0, 1 - target * output)
/// Note: Unlike MSE/MAE, Hinge does NOT divide by number of outputs per record.
///
/// # Arguments
/// * `network` - The compiled network to activate
/// * `records` - Packed array of `[inputs..., targets...]` records
/// * `input_size` - Number of inputs per record
/// * `num_outputs` - Number of outputs per record
/// * `forward_only` - If true, skip reset_state() (for forward-only networks)
///
/// # Returns
/// Sum of per-record Hinge errors (divide by record count for mean)
#[wasm_bindgen]
pub fn hinge_sum_batch_packed(
    network: &mut CompiledNetwork,
    records: &[f32],
    input_size: usize,
    num_outputs: usize,
    forward_only: bool,
) -> f64 {
    let values_per_record = input_size + num_outputs;
    if values_per_record == 0 {
        return 0.0;
    }
    let num_records = records.len() / values_per_record;
    if num_records == 0 {
        return 0.0;
    }

    // Issue #1209 - Use batched 8-record SIMD path for forward-only networks
    if forward_only && num_records >= 8 {
        return hinge_sum_batch_8way(
            network,
            records,
            values_per_record,
            input_size,
            num_outputs,
            num_records,
        );
    }

    let mut outputs: Vec<f32> = vec![0.0; num_outputs];
    let mut sum_error: f64 = 0.0;

    for record_idx in 0..num_records {
        if !forward_only {
            network.reset_state();
        }

        let base = record_idx * values_per_record;
        let input_start = base;
        let input_end = base + input_size;
        let target_start = input_end;

        network.activate_into(&records[input_start..input_end], &mut outputs[..]);

        // Per-record Hinge = Σmax(0, 1 - target * output)
        // Note: No averaging per record to match JS implementation
        let mut hinge_sum: f64 = 0.0;
        for j in 0..num_outputs {
            let t = records[target_start + j] as f64;
            let o = outputs[j] as f64;
            hinge_sum += (1.0 - t * o).max(0.0);
        }
        sum_error += hinge_sum;
    }

    sum_error
}

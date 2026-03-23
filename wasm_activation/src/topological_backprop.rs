//! Issue #1954 - Topological backpropagation loop in WASM.
//!
//! Migrates the entire backward pass loop from TypeScript to a single WASM call,
//! eliminating thousands of JS↔WASM boundary crossings per training sample.
//!
//! The function receives pre-serialised creature state (neuron data, synapse data,
//! topology, activations, sparse config, backprop config) and returns updated
//! neuron/synapse accumulation state plus cached activation values.

use wasm_bindgen::prelude::*;

use crate::accumulate::accumulate_weight_single;
use crate::elastic_distribution::apply_distribute_elastic_error;
use crate::fused_error::apply_fused_error_distribution;
use crate::squash::{apply_squash, SquashType};
use crate::unsquash::apply_unsquash;
/// Neuron type constants matching TypeScript.
const NEURON_TYPE_INPUT: u8 = 0;
const NEURON_TYPE_CONSTANT: u8 = 3;

/// Issue #1954 - Run the full topological backpropagation loop in WASM.
///
/// This replaces ~N per-neuron WASM calls with a single call that processes
/// all neurons in reverse topological order.
///
/// # Binary input format (packed into `data`)
///
/// ```text
/// Header (40 bytes):
///   u32: neuronCount
///   u32: inputCount
///   u32: outputCount
///   u32: synapseCount
///   u32: orderLength
///   u32: totalInwardEntries
///   f64: plankConstant
///   u8:  normaliseGradients (0 or 1)
///   [3 bytes padding]
///
/// Per neuron (neuronCount × 20 bytes):
///   u8:  squashType
///   u8:  neuronType (0=input, 1=hidden, 2=output, 3=constant)
///   u8:  propagateNeeded (0 or 1)
///   u8:  updateNeeded (0 or 1)
///   f32: hintValue
///   f32: rangeLow
///   f32: rangeHigh
///   f32: adjustedActivation
///   f32: adjustedBias (for non-input neurons)
///
/// Per synapse (synapseCount × 20 bytes):
///   u32: from
///   u32: to
///   f32: originalWeight
///   f32: adjustedWeight
///   u8:  isSelfLoop (0 or 1)
///   [3 bytes padding]
///
/// Inward mapping (neuronCount × 8 bytes):
///   u32: start index into inwardIndices
///   u32: count of inward connections
///
/// Inward indices (totalInwardEntries × 4 bytes):
///   u32[]: synapse indices
///
/// Reverse topological order (orderLength × 4 bytes):
///   u32[]: neuron indices
///
/// Expected outputs (outputCount × 4 bytes):
///   f32[]: expected values
/// ```
///
/// # Return format (packed f64 array)
///
/// ```text
/// Section 1: Per-neuron results (neuronCount × 7 f64s):
///   f64: totalErrorAbsoluteDelta
///   f64: cachedActivation (NaN if not set)
///   f64: noChange (1.0 = true, 0.0 = false)
///   f64: biasCountDelta
///   f64: totalBiasDelta
///   f64: totalAdjustedBiasDelta
///   f64: traceActivation (NaN if not traced)
///
/// Section 2: Per-synapse results (synapseCount × 7 f64s):
///   f64: countDelta
///   f64: totalPositiveActivation
///   f64: totalNegativeActivation
///   f64: countPositiveActivations
///   f64: countNegativeActivations
///   f64: totalPositiveAdjustedValue
///   f64: totalNegativeAdjustedValue
/// ```
#[wasm_bindgen]
pub fn propagate_topological(data: &[u8]) -> Vec<f64> {
    // ---- Parse header ----
    let neuron_count = read_u32(data, 0) as usize;
    let input_count = read_u32(data, 4) as usize;
    let output_count = read_u32(data, 8) as usize;
    let synapse_count = read_u32(data, 12) as usize;
    let order_length = read_u32(data, 16) as usize;
    let total_inward = read_u32(data, 20) as usize;
    let plank_constant = read_f64(data, 24) as f32;
    let normalise_gradients = data[32] != 0;
    // 3 bytes padding at 33..36

    let header_size: usize = 36;

    // ---- Parse neuron data ----
    let neuron_data_start = header_size;
    let neuron_stride: usize = 24; // Updated: 4 bytes squash+type+prop+update + 5×f32 = 24 bytes

    struct NeuronInfo {
        squash_type: u8,
        neuron_type: u8,
        propagate_needed: bool,
        update_needed: bool,
        hint_value: f32,
        range_low: f32,
        range_high: f32,
        adjusted_activation: f32,
        adjusted_bias: f32,
    }

    let mut neurons: Vec<NeuronInfo> = Vec::with_capacity(neuron_count);
    for i in 0..neuron_count {
        let base = neuron_data_start + i * neuron_stride;
        neurons.push(NeuronInfo {
            squash_type: data[base],
            neuron_type: data[base + 1],
            propagate_needed: data[base + 2] != 0,
            update_needed: data[base + 3] != 0,
            hint_value: read_f32(data, base + 4),
            range_low: read_f32(data, base + 8),
            range_high: read_f32(data, base + 12),
            adjusted_activation: read_f32(data, base + 16),
            adjusted_bias: read_f32(data, base + 20),
        });
    }

    // ---- Parse synapse data ----
    let synapse_data_start = neuron_data_start + neuron_count * neuron_stride;
    let synapse_stride: usize = 20;

    struct SynapseInfo {
        from: u32,
        to: u32,
        original_weight: f32,
        adjusted_weight: f32,
        is_self_loop: bool,
    }

    let mut synapses: Vec<SynapseInfo> = Vec::with_capacity(synapse_count);
    for i in 0..synapse_count {
        let base = synapse_data_start + i * synapse_stride;
        synapses.push(SynapseInfo {
            from: read_u32(data, base),
            to: read_u32(data, base + 4),
            original_weight: read_f32(data, base + 8),
            adjusted_weight: read_f32(data, base + 12),
            is_self_loop: data[base + 16] != 0,
        });
    }

    // ---- Parse inward mapping ----
    let inward_map_start = synapse_data_start + synapse_count * synapse_stride;
    let inward_map_stride: usize = 8; // u32 start + u32 count

    struct InwardMapping {
        start: usize,
        count: usize,
    }

    let mut inward_map: Vec<InwardMapping> = Vec::with_capacity(neuron_count);
    for i in 0..neuron_count {
        let base = inward_map_start + i * inward_map_stride;
        inward_map.push(InwardMapping {
            start: read_u32(data, base) as usize,
            count: read_u32(data, base + 4) as usize,
        });
    }

    // ---- Parse inward indices ----
    let inward_idx_start = inward_map_start + neuron_count * inward_map_stride;
    let mut inward_indices: Vec<u32> = Vec::with_capacity(total_inward);
    for i in 0..total_inward {
        inward_indices.push(read_u32(data, inward_idx_start + i * 4));
    }

    // ---- Parse reverse topological order ----
    let order_start = inward_idx_start + total_inward * 4;
    let mut order: Vec<u32> = Vec::with_capacity(order_length);
    for i in 0..order_length {
        order.push(read_u32(data, order_start + i * 4));
    }

    // ---- Parse expected outputs ----
    let expected_start = order_start + order_length * 4;
    let mut expected: Vec<f32> = Vec::with_capacity(output_count);
    for i in 0..output_count {
        expected.push(read_f32(data, expected_start + i * 4));
    }

    // ---- Allocate result arrays ----
    let neuron_result_stride = 7_usize;
    let synapse_result_stride = 7_usize;
    let result_size = neuron_count * neuron_result_stride + synapse_count * synapse_result_stride;
    let mut result = vec![0.0_f64; result_size];

    // Initialise neuron results: set cachedActivation and traceActivation to NaN
    for i in 0..neuron_count {
        let base = i * neuron_result_stride;
        result[base + 1] = f64::NAN; // cachedActivation not set
        result[base + 6] = f64::NAN; // traceActivation not set
    }

    // ---- Working arrays ----
    let mut target_delta_sum = vec![0.0_f64; neuron_count];
    let mut target_delta_count = vec![0_u32; neuron_count];

    // Mutable copy of adjusted activations (gets updated during the loop)
    let mut cached_activations: Vec<f32> = neurons.iter().map(|n| n.adjusted_activation).collect();

    // ---- Seed output neurons ----
    let last_output_idx = neuron_count - output_count;
    for i in 0..output_count {
        let node_index = last_output_idx + i;
        let n = &neurons[node_index];
        if n.propagate_needed {
            let activation = cached_activations[node_index];
            target_delta_sum[node_index] = (expected[i] - activation) as f64;
            target_delta_count[node_index] = 1;
        }
    }

    // ---- Main loop: process neurons in reverse topological order ----
    for order_idx in 0..order_length {
        let neuron_index = order[order_idx] as usize;

        if target_delta_count[neuron_index] == 0 {
            continue;
        }

        let neuron = &neurons[neuron_index];
        if !neuron.propagate_needed {
            continue;
        }

        let activation = cached_activations[neuron_index];
        let squash_type = SquashType::from(neuron.squash_type);

        // Compute target activation
        let count = target_delta_count[neuron_index];
        let total_delta = if normalise_gradients && count > 1 {
            target_delta_sum[neuron_index] / (count as f64).sqrt()
        } else {
            target_delta_sum[neuron_index]
        };
        let requested_activation = activation as f64 + total_delta;
        let target_activation = clamp_to_range(
            requested_activation as f32,
            neuron.range_low,
            neuron.range_high,
        );

        let raw_error_abs = (target_activation - activation).abs();
        if raw_error_abs < plank_constant {
            // noChange path - mark with sentinel for TS fallback.
            // The recursive noChangePropagate behaviour cannot be replicated
            // in WASM, so we signal the TS wrapper to fall back entirely.
            let nbase = neuron_index * neuron_result_stride;
            result[nbase + 1] = f64::NEG_INFINITY; // sentinel: needs TS noChange fallback
            result[nbase + 2] = 1.0; // noChange = true
            continue;
        }

        // Update totalErrorAbsolute
        let nbase = neuron_index * neuron_result_stride;
        result[nbase] += raw_error_abs as f64;

        let update_needed = neuron.update_needed;
        if !update_needed {
            result[nbase + 2] = 1.0; // noChange = true
        }

        // Check for custom propagate (IF/MAXIMUM/MINIMUM)
        // These are handled by the fallback path - we skip them in WASM
        // and return a marker so TS can handle them
        if squash_type == SquashType::If
            || squash_type == SquashType::Maximum
            || squash_type == SquashType::Minimum
        {
            // Mark as needing TS fallback - set cachedActivation to INFINITY
            // as a sentinel that TS will detect
            result[nbase + 1] = f64::INFINITY;
            // Store the target activation in traceActivation slot for TS to use
            result[nbase + 6] = target_activation as f64;
            continue;
        }

        // Standard neuron processing
        let current_bias = neuron.adjusted_bias;
        let mut improved_value = current_bias as f64;

        let inward = &inward_map[neuron_index];
        let list_length = inward.count;

        let limited_activation: f32;

        if list_length > 0 {
            // Build arrays for fused error distribution
            let mut fused_squash_types = Vec::with_capacity(list_length);
            let mut fused_hint_values = Vec::with_capacity(list_length);
            let mut fused_activations = Vec::with_capacity(list_length);
            let mut fused_weights = Vec::with_capacity(list_length);
            let mut from_activation_cache = Vec::with_capacity(list_length);
            let mut from_weight_cache = Vec::with_capacity(list_length);
            let mut from_value_cache = Vec::with_capacity(list_length);

            for indx in 0..list_length {
                let syn_idx = inward_indices[inward.start + indx] as usize;
                let syn = &synapses[syn_idx];

                if syn.is_self_loop {
                    fused_squash_types.push(SquashType::Identity as u8);
                    fused_hint_values.push(0.0_f32);
                    fused_activations.push(0.0_f32);
                    fused_weights.push(0.0_f32);
                    from_activation_cache.push(0.0_f32);
                    from_weight_cache.push(0.0_f32);
                    from_value_cache.push(0.0_f32);
                    continue;
                }

                let from_idx = syn.from as usize;
                let from_neuron = &neurons[from_idx];
                let from_activation = cached_activations[from_idx];
                let from_weight = syn.adjusted_weight;

                from_activation_cache.push(from_activation);
                from_weight_cache.push(from_weight);
                from_value_cache.push(from_weight * from_activation);
                fused_activations.push(from_activation);
                fused_weights.push(from_weight);

                let ftype = from_neuron.neuron_type;
                if ftype != NEURON_TYPE_INPUT
                    && ftype != NEURON_TYPE_CONSTANT
                    && from_neuron.propagate_needed
                {
                    fused_squash_types.push(from_neuron.squash_type);
                    fused_hint_values.push(from_neuron.hint_value);
                } else {
                    fused_squash_types.push(SquashType::Identity as u8);
                    fused_hint_values.push(0.0);
                }
            }

            // Single fused error distribution call (now internal, no WASM boundary)
            let fused_result = apply_fused_error_distribution(
                squash_type,
                activation,
                target_activation,
                neuron.hint_value,
                &fused_squash_types,
                &fused_hint_values,
                &fused_activations,
                &fused_weights,
            );

            let error = fused_result[0];

            // Extract safe zone factors
            let mut safe_zone_factors = Vec::with_capacity(list_length);
            for i in 0..list_length {
                let syn_idx = inward_indices[inward.start + i] as usize;
                let syn = &synapses[syn_idx];
                if syn.is_self_loop {
                    safe_zone_factors.push(0.0_f32);
                } else {
                    safe_zone_factors.push(fused_result[1 + i]);
                }
            }

            // Check safe zone collapse
            let mut has_usable_safe_zone = false;
            for i in 0..list_length {
                let safe = safe_zone_factors[i];
                if safe.is_finite() && safe > plank_constant {
                    has_usable_safe_zone = true;
                    break;
                }
            }

            let per_link_error: Vec<f32>;
            if has_usable_safe_zone {
                per_link_error = fused_result[1 + list_length..1 + 2 * list_length].to_vec();
            } else {
                // Elastic error distribution fallback
                let fallback_activations: Vec<f32> = (0..list_length)
                    .map(|i| fused_activations[i])
                    .collect();
                let fallback_safe: Vec<f32> = vec![1.0; list_length];
                per_link_error = apply_distribute_elastic_error(
                    error,
                    &fallback_activations,
                    &fallback_safe,
                    &from_weight_cache,
                    plank_constant,
                );
            }

            // Distribute error upstream and accumulate weights
            for indx in 0..list_length {
                let syn_idx = inward_indices[inward.start + indx] as usize;
                let syn = &synapses[syn_idx];

                if syn.is_self_loop {
                    continue;
                }

                let from_idx = syn.from as usize;
                let from_neuron = &neurons[from_idx];
                let from_activation = from_activation_cache[indx];
                let from_weight = from_weight_cache[indx];
                let from_value = from_value_cache[indx];
                let this_link_error = per_link_error[indx];
                let target_from_value = from_value + this_link_error;

                let ftype = from_neuron.neuron_type;
                if ftype != NEURON_TYPE_INPUT
                    && ftype != NEURON_TYPE_CONSTANT
                    && from_neuron.propagate_needed
                    && (target_from_value - from_value).abs() > plank_constant
                {
                    // Compute target activation for upstream neuron
                    let effective_weight = if from_weight.abs() > plank_constant {
                        from_weight
                    } else {
                        plank_constant * if from_weight >= 0.0 { 1.0 } else { -1.0 }
                    };
                    let target_from_activation = target_from_value / effective_weight;
                    let safe_zone_factor = safe_zone_factors[indx];

                    if safe_zone_factor.is_finite() && safe_zone_factor > 0.0 {
                        // Clamp to from neuron's range
                        let clamped_target = target_from_activation.clamp(
                            from_neuron.range_low,
                            from_neuron.range_high,
                        );
                        if clamped_target.is_finite() && from_idx >= input_count {
                            target_delta_sum[from_idx] +=
                                (clamped_target - from_activation) as f64;
                            target_delta_count[from_idx] += 1;
                        }
                    }
                }

                // Accumulate weight
                if update_needed && from_activation.abs() > plank_constant {
                    let (d_count, d_pos_act, d_neg_act, d_cnt_pos, d_cnt_neg, d_pos_adj, d_neg_adj) =
                        accumulate_weight_single(
                            syn.original_weight as f64,
                            target_from_value as f64,
                            from_activation as f64,
                            plank_constant as f64,
                            0.0, // learning_rate (unused in accumulate_weight_single)
                            0.0, // max_weight_adj_scale (unused)
                            0.0, // limit_weight_scale (unused)
                        );

                    let sbase = neuron_count * neuron_result_stride + syn_idx * synapse_result_stride;
                    result[sbase] += d_count;
                    result[sbase + 1] += d_pos_act;
                    result[sbase + 2] += d_neg_act;
                    result[sbase + 3] += d_cnt_pos;
                    result[sbase + 4] += d_cnt_neg;
                    result[sbase + 5] += d_pos_adj;
                    result[sbase + 6] += d_neg_adj;

                    // Compute improved value for bias accumulation
                    // adjustedWeight after accumulation (using current adjusted weight)
                    let a_weight = syn.adjusted_weight;
                    let improved_from_value = from_activation as f64 * a_weight as f64;
                    improved_value += improved_from_value;
                }
            }
        }

        if update_needed {
            // Compute target value (unSquash)
            let target_value = apply_unsquash(
                squash_type,
                target_activation,
                neuron.hint_value,
            );

            // Accumulate bias
            let bias_delta = target_value as f64 - improved_value;
            let target_bias = current_bias as f64 + bias_delta;

            if target_bias.is_finite() {
                result[nbase + 3] += 1.0; // biasCountDelta
                result[nbase + 4] += target_bias; // totalBiasDelta
                result[nbase + 5] += target_bias; // totalAdjustedBiasDelta
            }

            // Compute limited activation
            let a_bias = neuron.adjusted_bias;
            limited_activation = apply_squash(
                squash_type,
                (improved_value + a_bias as f64 - current_bias as f64) as f32,
            );
        } else {
            limited_activation = apply_squash(squash_type, improved_value as f32);
        }

        if update_needed {
            result[nbase + 6] = limited_activation as f64; // traceActivation
        }
        result[nbase + 1] = limited_activation as f64; // cachedActivation
        cached_activations[neuron_index] = limited_activation;
    }

    result
}

// ---- Helper functions for binary reading ----

#[inline(always)]
fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

#[inline(always)]
fn read_f32(data: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

#[inline(always)]
fn read_f64(data: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
    ])
}

#[inline(always)]
fn clamp_to_range(value: f32, low: f32, high: f32) -> f32 {
    value.clamp(low, high)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_u32(buf: &mut Vec<u8>, val: u32) {
        buf.extend_from_slice(&val.to_le_bytes());
    }

    fn write_f32(buf: &mut Vec<u8>, val: f32) {
        buf.extend_from_slice(&val.to_le_bytes());
    }

    fn write_f64(buf: &mut Vec<u8>, val: f64) {
        buf.extend_from_slice(&val.to_le_bytes());
    }

    /// Build a minimal single-neuron network: Input → Output (IDENTITY)
    fn build_simple_network(
        input_activation: f32,
        weight: f32,
        bias: f32,
        expected_output: f32,
    ) -> Vec<u8> {
        let neuron_count: u32 = 2; // input + output
        let input_count: u32 = 1;
        let output_count: u32 = 1;
        let synapse_count: u32 = 1;
        let order_length: u32 = 1; // just the output neuron
        let total_inward: u32 = 1;
        let plank_constant: f64 = 1e-7;

        let mut buf = Vec::new();

        // Header
        write_u32(&mut buf, neuron_count);
        write_u32(&mut buf, input_count);
        write_u32(&mut buf, output_count);
        write_u32(&mut buf, synapse_count);
        write_u32(&mut buf, order_length);
        write_u32(&mut buf, total_inward);
        write_f64(&mut buf, plank_constant);
        buf.push(0); // normaliseGradients
        buf.extend_from_slice(&[0, 0, 0]); // padding

        // Neuron 0: input
        let output_activation = weight * input_activation + bias;
        buf.push(SquashType::Identity as u8); // squashType
        buf.push(NEURON_TYPE_INPUT); // neuronType
        buf.push(0); // propagateNeeded
        buf.push(0); // updateNeeded
        write_f32(&mut buf, 0.0); // hintValue
        write_f32(&mut buf, f32::NEG_INFINITY); // rangeLow
        write_f32(&mut buf, f32::INFINITY); // rangeHigh
        write_f32(&mut buf, input_activation); // adjustedActivation
        write_f32(&mut buf, 0.0); // adjustedBias

        // Neuron 1: output (IDENTITY)
        buf.push(SquashType::Identity as u8); // squashType
        buf.push(2); // neuronType = OUTPUT
        buf.push(1); // propagateNeeded
        buf.push(1); // updateNeeded
        write_f32(&mut buf, output_activation); // hintValue (pre-squash)
        write_f32(&mut buf, f32::NEG_INFINITY); // rangeLow (Identity has no limit)
        write_f32(&mut buf, f32::INFINITY); // rangeHigh
        write_f32(&mut buf, output_activation); // adjustedActivation
        write_f32(&mut buf, bias); // adjustedBias

        // Synapse 0: input(0) → output(1)
        write_u32(&mut buf, 0); // from
        write_u32(&mut buf, 1); // to
        write_f32(&mut buf, weight); // originalWeight
        write_f32(&mut buf, weight); // adjustedWeight
        buf.push(0); // isSelfLoop
        buf.extend_from_slice(&[0, 0, 0]); // padding

        // Inward mapping
        // Neuron 0 (input): no inward connections
        write_u32(&mut buf, 0); // start
        write_u32(&mut buf, 0); // count
        // Neuron 1 (output): 1 inward connection
        write_u32(&mut buf, 0); // start
        write_u32(&mut buf, 1); // count

        // Inward indices
        write_u32(&mut buf, 0); // synapse index 0

        // Reverse topological order: just the output neuron
        write_u32(&mut buf, 1); // neuron index 1

        // Expected outputs
        write_f32(&mut buf, expected_output);

        buf
    }

    #[test]
    fn test_simple_identity_backprop() {
        // Input=1.0, weight=0.5, bias=0 → activation=0.5
        // Expected=0.8 → error=0.3
        let data = build_simple_network(1.0, 0.5, 0.0, 0.8);
        let result = propagate_topological(&data);

        // Check output neuron (index 1) results
        let nbase = 1 * 7; // neuron 1, stride 7
        let total_error = result[nbase]; // totalErrorAbsoluteDelta
        let cached_act = result[nbase + 1]; // cachedActivation
        let trace_act = result[nbase + 6]; // traceActivation

        // Error should be 0.3
        assert!(
            (total_error - 0.3).abs() < 1e-4,
            "totalError={}, expected ~0.3",
            total_error
        );

        // Cached activation should be finite
        assert!(
            cached_act.is_finite(),
            "cachedActivation should be finite, got {}",
            cached_act
        );

        // Trace activation should be set
        assert!(
            trace_act.is_finite(),
            "traceActivation should be finite, got {}",
            trace_act
        );

        // Synapse should have weight accumulation
        let sbase = 2 * 7; // neuron_count(2) * 7 + synapse 0 * 7
        let syn_count = result[sbase]; // countDelta
        assert!(syn_count > 0.0, "synapse count should be > 0, got {}", syn_count);
    }

    #[test]
    fn test_no_error_produces_no_change() {
        // Input=0.5, weight=1.0, bias=0 → activation=0.5
        // Expected=0.5 → error=0
        let data = build_simple_network(0.5, 1.0, 0.0, 0.5);
        let result = propagate_topological(&data);

        let nbase = 1 * 7;
        let total_error = result[nbase]; // totalErrorAbsoluteDelta
        let no_change = result[nbase + 2]; // noChange

        // Error below plank constant → noChange
        assert!(
            total_error < 1e-6,
            "totalError should be ~0, got {}",
            total_error
        );
        assert!(
            no_change > 0.5,
            "noChange should be true (1.0), got {}",
            no_change
        );
    }
}

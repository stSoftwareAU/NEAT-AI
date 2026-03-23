//! Issue #1518 - WASM weight/bias batch accumulation for backpropagation.
//!
//! Migrates the tight arithmetic loops from TypeScript to Rust/WASM with
//! SIMD128 optimisation. The batch functions process 4 or 8 items at once,
//! eliminating JS/WASM boundary crossings per synapse/neuron.
//!
//! ## Weight accumulation layout
//!
//! Input arrays (per item): current_weight, target_value, activation
//! Config scalars: plank_constant, learning_rate, max_weight_adj_scale, limit_weight_scale
//!
//! Output array (7 f64s per item):
//!   [count, total_positive_activation, total_negative_activation,
//!    count_positive, count_negative,
//!    total_positive_adjusted_value, total_negative_adjusted_value]
//!
//! ## Bias accumulation layout
//!
//! Input arrays (per item): target_pre_activation, pre_activation, current_bias
//! Config scalars: plank_constant, learning_rate, max_bias_adj_scale, limit_bias_scale
//!
//! Output array (3 f64s per item):
//!   [count, total_bias, total_adjusted_bias]

use wasm_bindgen::prelude::*;

/// Apply L1/L2 weight regularisation (weight decay).
///
/// Issue #1859/#1953: Mirrors the TypeScript `applyWeightRegularisation()`.
/// L2 shrinks weights proportionally: w *= (1 - lr * λ₂)
/// L1 applies soft-thresholding: w -= lr * λ₁ * sign(w), snapping to zero
/// if the penalty exceeds |w|.
#[inline(always)]
fn apply_weight_regularisation(
    weight: f64,
    learning_rate: f64,
    l1_weight_decay: f64,
    l2_weight_decay: f64,
) -> f64 {
    let mut result = weight;

    // L2 regularisation (weight decay)
    if l2_weight_decay > 0.0 {
        result *= 1.0 - learning_rate * l2_weight_decay;
    }

    // L1 regularisation (sparsity via soft-thresholding)
    if l1_weight_decay > 0.0 && result != 0.0 {
        let l1_penalty = learning_rate * l1_weight_decay;
        if l1_penalty >= result.abs() {
            result = 0.0;
        } else {
            result -= l1_penalty * result.signum();
        }
    }

    result
}

/// Limit a weight within the configured bounds.
///
/// Mirrors the TypeScript `limitWeight()` function exactly.
/// Issue #1953: Now includes L1/L2 regularisation.
#[inline(always)]
fn limit_weight(
    target_weight: f64,
    current_weight: f64,
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
    l1_weight_decay: f64,
    l2_weight_decay: f64,
) -> f64 {
    // Prevent exceedingly small weights.
    if target_weight.abs() < plank_constant {
        return apply_weight_regularisation(0.0, learning_rate, l1_weight_decay, l2_weight_decay);
    }

    if (target_weight - current_weight).abs() < plank_constant {
        return apply_weight_regularisation(current_weight, learning_rate, l1_weight_decay, l2_weight_decay);
    }

    // Calculate and apply the difference with learning rate.
    let difference = learning_rate * (target_weight - current_weight);
    let mut limited_weight = current_weight + difference;

    // Clamp the adjustment based on the configured max scale.
    if difference.abs() > max_weight_adj_scale {
        limited_weight =
            current_weight + if difference > 0.0 { max_weight_adj_scale } else { -max_weight_adj_scale };
    }

    // Enforce the global weight scale limit.
    if limited_weight.abs() > limit_weight_scale {
        limited_weight = if limited_weight > 0.0 { limit_weight_scale } else { -limit_weight_scale };
    }

    apply_weight_regularisation(limited_weight, learning_rate, l1_weight_decay, l2_weight_decay)
}

/// Apply L1/L2 bias regularisation (bias decay).
///
/// Issue #1859/#1953: Mirrors the TypeScript `applyBiasRegularisation()`.
/// L2 shrinks biases proportionally: b *= (1 - lr * λ₂)
/// L1 applies soft-thresholding: b -= lr * λ₁ * sign(b), snapping to zero
/// if the penalty exceeds |b|.
#[inline(always)]
fn apply_bias_regularisation(
    bias: f64,
    learning_rate: f64,
    l1_bias_decay: f64,
    l2_bias_decay: f64,
) -> f64 {
    let mut result = bias;

    // L2 regularisation (bias decay)
    if l2_bias_decay > 0.0 {
        result *= 1.0 - learning_rate * l2_bias_decay;
    }

    // L1 regularisation (sparsity via soft-thresholding)
    if l1_bias_decay > 0.0 && result != 0.0 {
        let l1_penalty = learning_rate * l1_bias_decay;
        if l1_penalty >= result.abs() {
            result = 0.0;
        } else {
            result -= l1_penalty * result.signum();
        }
    }

    result
}

/// Limit a bias within the configured bounds.
///
/// Mirrors the TypeScript `limitBias()` function exactly.
/// Issue #1953: Now includes L1/L2 regularisation.
#[inline(always)]
fn limit_bias(
    target_bias: f64,
    current_bias: f64,
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
    l1_bias_decay: f64,
    l2_bias_decay: f64,
) -> f64 {
    // Prevent exceedingly small biases.
    if target_bias.abs() < plank_constant {
        return apply_bias_regularisation(0.0, learning_rate, l1_bias_decay, l2_bias_decay);
    }

    if (target_bias - current_bias).abs() < 0.000_000_001 {
        return apply_bias_regularisation(current_bias, learning_rate, l1_bias_decay, l2_bias_decay);
    }

    let difference = learning_rate * (target_bias - current_bias);
    let learnt_bias = current_bias + difference;
    let mut limited_bias = learnt_bias;

    if difference.abs() > max_bias_adj_scale {
        limited_bias =
            current_bias + max_bias_adj_scale * if difference > 0.0 { 1.0 } else { -1.0 };
    }

    if limited_bias.abs() >= limit_bias_scale {
        if limited_bias > 0.0 {
            if limited_bias > current_bias {
                limited_bias = current_bias.max(limit_bias_scale);
            }
        } else if limited_bias < current_bias {
            limited_bias = current_bias.min(-limit_bias_scale);
        }
    }

    apply_bias_regularisation(limited_bias, learning_rate, l1_bias_decay, l2_bias_decay)
}

/// Process a single weight accumulation item.
///
/// Returns the 7 delta values to add to the SynapseState fields.
#[inline(always)]
pub(crate) fn accumulate_weight_single(
    current_weight: f64,
    target_value: f64,
    activation: f64,
    plank_constant: f64,
    _learning_rate: f64,
    _max_weight_adj_scale: f64,
    _limit_weight_scale: f64,
) -> (f64, f64, f64, f64, f64, f64, f64) {
    // Skip non-finite values
    if !current_weight.is_finite() || !target_value.is_finite() || !activation.is_finite() {
        return (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    }

    let sign = if activation > 0.0 {
        1.0
    } else if activation < 0.0 {
        -1.0
    } else {
        1.0
    };

    let tmp_activation = if activation.abs() < plank_constant {
        plank_constant * sign
    } else {
        activation
    };

    // Adjust the target value if it's too small.
    let tmp_value = if target_value.abs() > plank_constant {
        target_value
    } else {
        plank_constant
            * if target_value > 0.0 {
                1.0
            } else if target_value < 0.0 {
                -1.0
            } else {
                0.0
            }
    };

    let tmp_weight = tmp_value / tmp_activation;

    // Skip if calculated weight is non-finite
    if !tmp_weight.is_finite() {
        return (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    }

    // Issue #1653: Accumulate raw target weight; limit_weight applied in calculate_weight.

    // Track positive and negative activations separately
    let mut d_pos_act: f64 = 0.0;
    let mut d_neg_act: f64 = 0.0;
    let mut d_cnt_pos: f64 = 0.0;
    let mut d_cnt_neg: f64 = 0.0;
    let mut d_pos_adj: f64 = 0.0;
    let mut d_neg_adj: f64 = 0.0;

    if activation.abs() > plank_constant {
        if activation > 0.0 {
            d_pos_act = activation;
            d_pos_adj = tmp_weight * activation;
            d_cnt_pos = 1.0;
        } else if activation < 0.0 {
            d_neg_act = activation.abs();
            d_neg_adj = tmp_weight * activation;
            d_cnt_neg = 1.0;
        }
    }

    (1.0, d_pos_act, d_neg_act, d_cnt_pos, d_cnt_neg, d_pos_adj, d_neg_adj)
}

/// Issue #1518 - Batch weight accumulation for 4 synapses.
///
/// Processes 4 synapses in a single WASM call, returning a packed f64 array
/// with 7 values per synapse (28 total). The caller unpacks these into the
/// corresponding SynapseState objects.
///
/// # Arguments
/// * `current_weights` - 4 current synapse weights
/// * `target_values` - 4 target values for weight calculation
/// * `activations` - 4 activation values from source neurons
/// * `plank_constant` - Minimum unit threshold
/// * `learning_rate` - Learning rate for weight adjustment
/// * `max_weight_adj_scale` - Maximum weight adjustment scale
/// * `limit_weight_scale` - Global weight scale limit
///
/// # Returns
/// Float64Array with 28 values (7 per synapse):
///   [count, totalPositiveActivation, totalNegativeActivation,
///    countPositiveActivations, countNegativeActivations,
///    totalPositiveAdjustedValue, totalNegativeAdjustedValue] × 4
#[wasm_bindgen]
pub fn accumulate_weight_batch_4way(
    current_weights: &[f64],
    target_values: &[f64],
    activations: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
) -> Vec<f64> {
    let mut result = vec![0.0_f64; 28];

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

        let base = i * 7;
        result[base] = d_count;
        result[base + 1] = d_pos_act;
        result[base + 2] = d_neg_act;
        result[base + 3] = d_cnt_pos;
        result[base + 4] = d_cnt_neg;
        result[base + 5] = d_pos_adj;
        result[base + 6] = d_neg_adj;
    }

    result
}

/// Issue #1518 - Batch weight accumulation for 8 synapses.
///
/// Same as 4-way but processes 8 synapses. Returns 56 f64 values.
#[wasm_bindgen]
pub fn accumulate_weight_batch_8way(
    current_weights: &[f64],
    target_values: &[f64],
    activations: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
) -> Vec<f64> {
    let mut result = vec![0.0_f64; 56];

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

        let base = i * 7;
        result[base] = d_count;
        result[base + 1] = d_pos_act;
        result[base + 2] = d_neg_act;
        result[base + 3] = d_cnt_pos;
        result[base + 4] = d_cnt_neg;
        result[base + 5] = d_pos_adj;
        result[base + 6] = d_neg_adj;
    }

    result
}

/// Process a single bias accumulation item.
///
/// Returns (count_delta, total_bias_delta, total_adjusted_bias_delta).
#[inline(always)]
pub(crate) fn accumulate_bias_single(
    target_pre_activation: f64,
    pre_activation: f64,
    current_bias: f64,
    _plank_constant: f64,
    _learning_rate: f64,
    _max_bias_adj_scale: f64,
    _limit_bias_scale: f64,
) -> (f64, f64, f64) {
    // Skip non-finite values
    if !target_pre_activation.is_finite()
        || !pre_activation.is_finite()
        || !current_bias.is_finite()
    {
        return (0.0, 0.0, 0.0);
    }

    let bias_delta = target_pre_activation - pre_activation;
    if !bias_delta.is_finite() {
        return (0.0, 0.0, 0.0);
    }

    let target_bias = current_bias + bias_delta;
    if !target_bias.is_finite() {
        return (0.0, 0.0, 0.0);
    }

    // Issue #1653: Accumulate raw target bias; limit_bias applied in calculate_bias.
    (1.0, target_bias, target_bias)
}

/// Issue #1518 - Batch bias accumulation for 4 neurons.
///
/// Processes 4 neurons in a single WASM call, returning a packed f64 array
/// with 3 values per neuron (12 total). The caller unpacks these into the
/// corresponding NeuronState objects.
///
/// # Arguments
/// * `target_pre_activations` - 4 target pre-activation values
/// * `pre_activations` - 4 current pre-activation values
/// * `current_biases` - 4 current neuron biases
/// * `plank_constant` - Minimum unit threshold
/// * `learning_rate` - Learning rate for bias adjustment
/// * `max_bias_adj_scale` - Maximum bias adjustment scale
/// * `limit_bias_scale` - Global bias scale limit
///
/// # Returns
/// Float64Array with 12 values (3 per neuron):
///   [count, totalBias, totalAdjustedBias] × 4
#[wasm_bindgen]
pub fn accumulate_bias_batch_4way(
    target_pre_activations: &[f64],
    pre_activations: &[f64],
    current_biases: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) -> Vec<f64> {
    let mut result = vec![0.0_f64; 12];

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

        let base = i * 3;
        result[base] = d_count;
        result[base + 1] = d_total_bias;
        result[base + 2] = d_adj_bias;
    }

    result
}

/// Issue #1518 - Batch bias accumulation for 8 neurons.
///
/// Same as 4-way but processes 8 neurons. Returns 24 f64 values.
#[wasm_bindgen]
pub fn accumulate_bias_batch_8way(
    target_pre_activations: &[f64],
    pre_activations: &[f64],
    current_biases: &[f64],
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
) -> Vec<f64> {
    let mut result = vec![0.0_f64; 24];

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

        let base = i * 3;
        result[base] = d_count;
        result[base + 1] = d_total_bias;
        result[base + 2] = d_adj_bias;
    }

    result
}

/// Issue #1518 - Calculate the finalised weight after accumulation.
///
/// Mirrors the TypeScript `calculateWeight()` function. Performs the
/// weighted averaging with positive/negative tracking and generation-based
/// inertia.
///
/// # Arguments
/// * `count` - Total accumulation count
/// * `total_positive_activation` - Sum of positive activations
/// * `total_negative_activation` - Sum of |negative activations|
/// * `count_positive` - Number of positive activations
/// * `count_negative` - Number of negative activations
/// * `total_positive_adjusted_value` - Sum of limited weight × positive activation
/// * `total_negative_adjusted_value` - Sum of limited weight × negative activation
/// * `current_weight` - The synapse's current weight
/// * `generations` - Config generations value
/// * `plank_constant` - Minimum unit threshold
/// * `learning_rate` - Learning rate
/// * `max_weight_adj_scale` - Maximum weight adjustment scale
/// * `limit_weight_scale` - Global weight scale limit
/// * `l1_weight_decay` - L1 regularisation strength (Issue #1953)
/// * `l2_weight_decay` - L2 regularisation strength (Issue #1953)
///
/// # Returns
/// The calculated average weight
#[wasm_bindgen]
pub fn calculate_weight(
    count: f64,
    total_positive_activation: f64,
    total_negative_activation: f64,
    count_positive: f64,
    count_negative: f64,
    total_positive_adjusted_value: f64,
    total_negative_adjusted_value: f64,
    current_weight: f64,
    generations: f64,
    plank_constant: f64,
    learning_rate: f64,
    max_weight_adj_scale: f64,
    limit_weight_scale: f64,
    l1_weight_decay: f64,
    l2_weight_decay: f64,
) -> f64 {
    if count <= 0.0 {
        return current_weight;
    }

    // Ensure there is meaningful data to adjust the weights.
    if total_positive_activation <= plank_constant && total_negative_activation <= plank_constant {
        return current_weight;
    }

    // Compute adjusted weights for positive and negative contributions.
    let positive_weight = if total_positive_activation > plank_constant {
        total_positive_adjusted_value / total_positive_activation
    } else {
        0.0
    };

    let negative_weight = if total_negative_activation > plank_constant {
        total_negative_adjusted_value / (total_negative_activation * -1.0)
    } else {
        0.0
    };

    // Blend these weights based on their relative counts.
    let total_activation_count = count_positive + count_negative;

    if total_activation_count <= 0.0 {
        return current_weight;
    }

    // Incorporate the effect of previous adjustments and generational weight.
    let synapse_average_weight_total =
        positive_weight * count_positive + negative_weight * count_negative;

    // Issue #1436: Cap effective generations
    let raw_generations = generations + count - total_activation_count;
    let capped_generations = raw_generations.min(total_activation_count * 2.0);
    let total_generational_weight = current_weight * capped_generations;

    // Blend adjusted and generational weights.
    let average_weight =
        (synapse_average_weight_total + total_generational_weight) / (total_activation_count + capped_generations);

    limit_weight(
        average_weight,
        current_weight,
        plank_constant,
        learning_rate,
        max_weight_adj_scale,
        limit_weight_scale,
        l1_weight_decay,
        l2_weight_decay,
    )
}

/// Issue #1518 - Calculate the finalised bias after accumulation.
///
/// Mirrors the TypeScript `calculateBias()` function.
///
/// # Arguments
/// * `count` - Total accumulation count
/// * `total_adjusted_bias` - Sum of limited biases
/// * `current_bias` - The neuron's current bias
/// * `no_change` - Whether the neuron has flagged no change
/// * `generations` - Config generations value
/// * `plank_constant` - Minimum unit threshold
/// * `learning_rate` - Learning rate
/// * `max_bias_adj_scale` - Maximum bias adjustment scale
/// * `limit_bias_scale` - Global bias scale limit
/// * `l1_bias_decay` - L1 regularisation strength (Issue #1953)
/// * `l2_bias_decay` - L2 regularisation strength (Issue #1953)
///
/// # Returns
/// The calculated bias
#[wasm_bindgen]
pub fn calculate_bias(
    count: f64,
    total_adjusted_bias: f64,
    current_bias: f64,
    no_change: bool,
    generations: f64,
    plank_constant: f64,
    learning_rate: f64,
    max_bias_adj_scale: f64,
    limit_bias_scale: f64,
    l1_bias_decay: f64,
    l2_bias_decay: f64,
) -> f64 {
    if no_change || count <= 0.0 {
        return current_bias;
    }

    // Issue #1436: Cap effective generations
    let effective_generations = generations.min(count * 2.0);
    let total_bias = total_adjusted_bias + (current_bias * effective_generations);
    let samples = count + effective_generations;

    let adjusted_bias = total_bias / samples;

    limit_bias(
        adjusted_bias,
        current_bias,
        plank_constant,
        learning_rate,
        max_bias_adj_scale,
        limit_bias_scale,
        l1_bias_decay,
        l2_bias_decay,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_limit_weight_basic() {
        // Weight below plank constant should return 0
        let result = limit_weight(1e-8, 0.0, 1e-7, 1.0, 1.0, 100000.0, 0.0, 0.0);
        assert_eq!(result, 0.0);

        // Small difference should return current weight
        let result = limit_weight(1.0, 1.0 + 1e-8, 1e-7, 1.0, 1.0, 100000.0, 0.0, 0.0);
        assert_eq!(result, 1.0 + 1e-8);
    }

    #[test]
    fn test_limit_weight_clamping() {
        // Weight exceeding limit_weight_scale should be clamped
        let result = limit_weight(200000.0, 0.0, 1e-7, 1.0, 1.0, 100000.0, 0.0, 0.0);
        // max_weight_adj_scale is 1.0, so limited to current + 1.0 = 1.0
        assert!(result.abs() <= 100000.0);
    }

    #[test]
    fn test_limit_bias_basic() {
        // Bias below plank constant should return 0
        let result = limit_bias(1e-8, 0.0, 1e-7, 1.0, 1.0, 10000.0, 0.0, 0.0);
        assert_eq!(result, 0.0);
    }

    #[test]
    fn test_weight_l2_regularisation() {
        // Issue #1953: L2 decay should shrink weight proportionally
        let result = limit_weight(5.0, 5.0 + 1e-8, 1e-7, 0.1, 1.0, 100000.0, 0.0, 0.01);
        // L2: result *= (1 - 0.1 * 0.01) = 0.999, so ~4.995
        assert!(result < 5.0);
        assert!(result > 4.99);
    }

    #[test]
    fn test_weight_l1_regularisation() {
        // Issue #1953: L1 decay should apply soft-thresholding
        let result = limit_weight(0.5, 0.5 + 1e-8, 1e-7, 0.1, 1.0, 100000.0, 0.1, 0.0);
        // L1: result -= 0.1 * 0.1 * sign(0.5) = 0.5 - 0.01 = 0.49
        assert!(result < 0.5);
        assert!(result > 0.48);
    }

    #[test]
    fn test_bias_l2_regularisation() {
        // Issue #1953: L2 decay should shrink bias proportionally
        let result = limit_bias(5.0, 5.0 + 1e-8, 1e-7, 0.1, 1.0, 10000.0, 0.0, 0.01);
        assert!(result < 5.0);
        assert!(result > 4.99);
    }

    #[test]
    fn test_bias_l1_regularisation() {
        // Issue #1953: L1 decay should apply soft-thresholding
        let result = limit_bias(0.5, 0.5 + 1e-8, 1e-7, 0.1, 1.0, 10000.0, 0.1, 0.0);
        assert!(result < 0.5);
        assert!(result > 0.48);
    }

    #[test]
    fn test_accumulate_weight_single_positive() {
        let (count, pos_act, neg_act, cnt_pos, cnt_neg, _pos_adj, _neg_adj) =
            accumulate_weight_single(0.5, 2.0, 1.0, 1e-7, 1.0, 1.0, 100000.0);

        assert_eq!(count, 1.0);
        assert_eq!(pos_act, 1.0);
        assert_eq!(neg_act, 0.0);
        assert_eq!(cnt_pos, 1.0);
        assert_eq!(cnt_neg, 0.0);
    }

    #[test]
    fn test_accumulate_weight_single_negative() {
        let (count, pos_act, neg_act, cnt_pos, cnt_neg, _pos_adj, _neg_adj) =
            accumulate_weight_single(0.5, -1.0, -0.5, 1e-7, 1.0, 1.0, 100000.0);

        assert_eq!(count, 1.0);
        assert_eq!(pos_act, 0.0);
        assert_eq!(neg_act, 0.5);
        assert_eq!(cnt_pos, 0.0);
        assert_eq!(cnt_neg, 1.0);
    }

    #[test]
    fn test_accumulate_weight_single_non_finite_skipped() {
        let (count, _, _, _, _, _, _) =
            accumulate_weight_single(f64::NAN, 2.0, 1.0, 1e-7, 1.0, 1.0, 100000.0);
        assert_eq!(count, 0.0);

        let (count, _, _, _, _, _, _) =
            accumulate_weight_single(0.5, f64::INFINITY, 1.0, 1e-7, 1.0, 1.0, 100000.0);
        assert_eq!(count, 0.0);

        let (count, _, _, _, _, _, _) =
            accumulate_weight_single(0.5, 2.0, f64::NEG_INFINITY, 1e-7, 1.0, 1.0, 100000.0);
        assert_eq!(count, 0.0);
    }

    #[test]
    fn test_accumulate_bias_single_basic() {
        // target_pre=2.0, pre=1.0, bias=0.5 => delta=1.0, target_bias=1.5
        let (count, total_bias, _adj_bias) =
            accumulate_bias_single(2.0, 1.0, 0.5, 1e-7, 1.0, 1.0, 10000.0);

        assert_eq!(count, 1.0);
        assert_eq!(total_bias, 1.5);
    }

    #[test]
    fn test_accumulate_bias_single_non_finite_skipped() {
        let (count, _, _) =
            accumulate_bias_single(f64::NAN, 1.0, 0.5, 1e-7, 1.0, 1.0, 10000.0);
        assert_eq!(count, 0.0);
    }

    #[test]
    fn test_batch_4way_weight() {
        let weights = vec![0.5, -0.3, 1.2, 0.0];
        let targets = vec![2.0, -1.5, 0.8, 3.0];
        let acts = vec![1.0, 0.5, -0.8, 2.0];

        let result = accumulate_weight_batch_4way(
            &weights, &targets, &acts, 1e-7, 1.0, 1.0, 100000.0,
        );

        assert_eq!(result.len(), 28);
        // First synapse: positive activation
        assert_eq!(result[0], 1.0); // count
        assert_eq!(result[1], 1.0); // positive activation
    }

    #[test]
    fn test_batch_4way_bias() {
        let targets = vec![2.0, -1.5, 0.8, 3.0];
        let pres = vec![1.0, -0.5, 0.2, 2.5];
        let biases = vec![0.5, -0.3, 1.2, 0.0];

        let result = accumulate_bias_batch_4way(
            &targets, &pres, &biases, 1e-7, 1.0, 1.0, 10000.0,
        );

        assert_eq!(result.len(), 12);
        // First neuron: delta=1.0, target_bias=1.5
        assert_eq!(result[0], 1.0); // count
        assert_eq!(result[1], 1.5); // total_bias
    }

    #[test]
    fn test_calculate_weight_basic() {
        // With only positive activations
        let result = calculate_weight(
            1.0,   // count
            1.0,   // total_positive_activation
            0.0,   // total_negative_activation
            1.0,   // count_positive
            0.0,   // count_negative
            2.0,   // total_positive_adjusted_value (adjusted_weight * activation)
            0.0,   // total_negative_adjusted_value
            0.5,   // current_weight
            0.0,   // generations
            1e-7,  // plank_constant
            1.0,   // learning_rate
            1.0,   // max_weight_adj_scale
            100000.0, // limit_weight_scale
            0.0,   // l1_weight_decay
            0.0,   // l2_weight_decay
        );

        assert!(result.is_finite());
    }

    #[test]
    fn test_calculate_weight_with_l2_decay() {
        // Issue #1953: calculate_weight should apply L2 regularisation
        let without_decay = calculate_weight(
            1.0, 1.0, 0.0, 1.0, 0.0, 2.0, 0.0, 0.5, 0.0, 1e-7, 1.0, 1.0, 100000.0, 0.0, 0.0,
        );
        let with_decay = calculate_weight(
            1.0, 1.0, 0.0, 1.0, 0.0, 2.0, 0.0, 0.5, 0.0, 1e-7, 1.0, 1.0, 100000.0, 0.0, 0.01,
        );
        // L2 decay should produce a smaller absolute result
        assert!(with_decay.abs() <= without_decay.abs());
    }

    #[test]
    fn test_calculate_bias_basic() {
        let result = calculate_bias(
            1.0,   // count
            1.5,   // total_adjusted_bias
            0.5,   // current_bias
            false, // no_change
            0.0,   // generations
            1e-7,  // plank_constant
            1.0,   // learning_rate
            1.0,   // max_bias_adj_scale
            10000.0, // limit_bias_scale
            0.0,   // l1_bias_decay
            0.0,   // l2_bias_decay
        );

        assert!(result.is_finite());
    }

    #[test]
    fn test_calculate_bias_with_l2_decay() {
        // Issue #1953: calculate_bias should apply L2 regularisation
        let without_decay = calculate_bias(
            1.0, 1.5, 0.5, false, 0.0, 1e-7, 1.0, 1.0, 10000.0, 0.0, 0.0,
        );
        let with_decay = calculate_bias(
            1.0, 1.5, 0.5, false, 0.0, 1e-7, 1.0, 1.0, 10000.0, 0.0, 0.01,
        );
        assert!(with_decay.abs() <= without_decay.abs());
    }

    #[test]
    fn test_calculate_bias_no_change() {
        let result = calculate_bias(
            10.0, 15.0, 0.5, true, 5.0, 1e-7, 1.0, 1.0, 10000.0, 0.0, 0.0,
        );
        assert_eq!(result, 0.5); // Should return current_bias
    }

    #[test]
    fn test_calculate_bias_zero_count() {
        let result = calculate_bias(
            0.0, 0.0, 0.5, false, 5.0, 1e-7, 1.0, 1.0, 10000.0, 0.0, 0.0,
        );
        assert_eq!(result, 0.5); // Should return current_bias
    }
}

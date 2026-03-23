//! Scoring pipeline for NEAT-AI creatures.
//!
//! Replicates the TypeScript scoring formula from `src/architecture/Score.ts`.
//! Issue #1967 - Build Rust CLI scorer application.

use neat_core::creature::CreatureExport;
use neat_core::squash::SquashType;

/// The current semantic major version matching the TypeScript constant.
/// Creatures not at this version receive a small penalty.
pub const SEMANTIC_MAJOR_VERSION: u32 = 4;

/// Calculates a penalty value based on the magnitude of a weight or bias.
///
/// Encourages smaller weights/biases. Returns 0 for values <= 1,
/// and approaches (but never reaches) 1 for large values.
/// Uses recursive logarithmic compression for very large values.
///
/// Matches the TypeScript `valuePenalty()` in `src/architecture/Score.ts`.
pub fn value_penalty(value: f64) -> f64 {
    assert!(value >= 0.0, "Value: {value} is negative");

    if value <= 1.0 {
        return 0.0;
    }

    assert!(value.is_finite(), "Value: {value} is not finite");

    let primary_penalty = 1.0 / (1.0 + 1.0 / value);

    if primary_penalty > 0.999 {
        let compress_penalty = 0.999 + value_penalty(value.ln()) / 1000.0;
        assert!(
            compress_penalty < 1.0,
            "Compressed Penalty: {compress_penalty} is >= 1"
        );
        return compress_penalty;
    }

    assert!(
        primary_penalty < 1.0,
        "Primary Penalty: {primary_penalty} is >= 1"
    );
    primary_penalty
}

/// Calculates the combined weight/bias penalty from max and average absolute values.
fn calculate_penalty(max: f64, avg: f64) -> f64 {
    let penalty = (value_penalty(max) + value_penalty(avg)) / 2.0;
    assert!(penalty.is_finite(), "Penalty: {penalty} is not finite");
    assert!(penalty >= 0.0, "Penalty: {penalty} is negative");
    assert!(penalty < 1.0, "Penalty: {penalty} is >= 1");
    penalty
}

/// Returns the squash function complexity penalty for a given squash type.
///
/// Only the IF aggregate function carries a non-zero complexity penalty (3).
/// All other activation functions have zero complexity penalty.
fn squash_complexity_penalty(squash_type: SquashType) -> f64 {
    match squash_type {
        SquashType::If => 3.0,
        _ => 0.0,
    }
}

/// Components extracted from a creature for score calculation.
pub struct ScoreComponents {
    /// Number of hidden neurons (excluding input and output).
    pub hidden_neuron_count: usize,
    /// Total number of synapses.
    pub synapse_count: usize,
    /// Maximum absolute weight or bias value.
    pub max_weight_bias: f64,
    /// Average absolute weight or bias value.
    pub avg_weight_bias: f64,
    /// Sum of squash function complexity penalties for all non-input neurons.
    pub squash_complexity_penalty: f64,
}

/// Computes score components from a creature export.
///
/// Iterates over synapses and neurons to gather weight/bias statistics
/// and squash complexity penalties.
pub fn compute_score_components(creature: &CreatureExport) -> ScoreComponents {
    let mut max_weight_bias: f64 = 0.0;
    let mut total_weight_bias: f64 = 0.0;
    let mut count_weight_bias: usize = 0;
    let mut squash_penalty: f64 = 0.0;

    // Gather weight statistics from synapses
    for synapse in &creature.synapses {
        assert!(
            synapse.weight.is_finite(),
            "Weight: {} is not finite",
            synapse.weight
        );
        let w = synapse.weight.abs();
        if w > max_weight_bias {
            max_weight_bias = w;
        }
        total_weight_bias += w;
        count_weight_bias += 1;
    }

    // Gather bias statistics and squash complexity from non-input neurons
    for neuron in &creature.neurons {
        assert!(
            neuron.bias.is_finite(),
            "Bias: {} is not finite",
            neuron.bias
        );
        let b = neuron.bias.abs();
        if b > max_weight_bias {
            max_weight_bias = b;
        }
        total_weight_bias += b;
        count_weight_bias += 1;

        // Accumulate squash complexity
        let squash_name = neuron.squash.as_deref().unwrap_or("IDENTITY");
        if let Ok(squash_type) = neat_core::creature::parse_squash_name(squash_name) {
            squash_penalty += squash_complexity_penalty(squash_type);
        }
    }

    // Overflow protection matching TypeScript behaviour
    let safe_max = if max_weight_bias > 9_007_199_254_740_992.0 {
        9_007_199_254_740_992.0 // Number.MAX_SAFE_INTEGER
    } else {
        max_weight_bias
    };
    let safe_total = if total_weight_bias > 9_007_199_254_740_992.0 {
        9_007_199_254_740_992.0
    } else {
        total_weight_bias
    };

    let avg_weight_bias = if count_weight_bias > 0 {
        safe_total / count_weight_bias as f64
    } else {
        0.0
    };

    let hidden_neuron_count = creature
        .neurons
        .iter()
        .filter(|n| n.neuron_type == "hidden" || n.neuron_type == "constant")
        .count();

    ScoreComponents {
        hidden_neuron_count,
        synapse_count: creature.synapses.len(),
        max_weight_bias: safe_max,
        avg_weight_bias,
        squash_complexity_penalty: squash_penalty,
    }
}

/// Calculates the final score for a creature.
///
/// Formula: `score = 1 - error - complexityPenalty - versionPenalty`
///
/// Where:
/// - `complexityPenalty = hiddenNeurons * growthCost + synapses * growthCost / 10
///                        + (weightBiasPenalty + squashComplexityPenalty) * growthCost / 100`
/// - `versionPenalty = 1e-6` if the creature's semantic version doesn't start with "4."
pub fn calculate_score(
    error: f64,
    components: &ScoreComponents,
    growth_cost: f64,
    semantic_version: Option<&str>,
) -> f64 {
    assert!(!error.is_nan(), "Error is NaN");
    assert!(error.is_finite(), "Error is not finite");
    assert!(error >= 0.0, "Error: {error} is negative");

    let weight_bias_penalty = calculate_penalty(components.max_weight_bias, components.avg_weight_bias);
    let total_penalty = weight_bias_penalty + components.squash_complexity_penalty;

    let complexity_penalty = components.hidden_neuron_count as f64 * growth_cost
        + components.synapse_count as f64 * growth_cost / 10.0
        + total_penalty * growth_cost / 100.0;

    let version_penalty = match semantic_version {
        Some(v) if v.starts_with(&format!("{SEMANTIC_MAJOR_VERSION}.")) => 0.0,
        _ => 1e-6,
    };

    let score = 1.0 - error - complexity_penalty - version_penalty;
    assert!(score <= 1.0, "Score: {score} is greater than 1");
    score
}

/// Result of scoring a creature against training data.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreResult {
    pub score: f64,
    pub error: f64,
    pub complexity_penalty: f64,
    pub record_count: usize,
    pub hidden_neurons: usize,
    pub synapse_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_value_penalty_zero_for_small_values() {
        assert_eq!(value_penalty(0.0), 0.0);
        assert_eq!(value_penalty(0.5), 0.0);
        assert_eq!(value_penalty(1.0), 0.0);
    }

    #[test]
    fn test_value_penalty_increases_with_magnitude() {
        let p2 = value_penalty(2.0);
        let p10 = value_penalty(10.0);
        let p100 = value_penalty(100.0);

        assert!(p2 > 0.0);
        assert!(p10 > p2);
        assert!(p100 > p10);
    }

    #[test]
    fn test_value_penalty_never_reaches_one() {
        let p = value_penalty(1_000_000.0);
        assert!(p < 1.0);
        assert!(p > 0.999);
    }

    #[test]
    fn test_value_penalty_known_values() {
        // valuePenalty(10) = 1 / (1 + 1/10) = 1 / 1.1 ≈ 0.9090909...
        let p = value_penalty(10.0);
        assert!((p - 0.909_090_909_090_909_1).abs() < 1e-12);

        // valuePenalty(2) = 1 / (1 + 1/2) = 1/1.5 ≈ 0.6666...
        let p2 = value_penalty(2.0);
        assert!((p2 - 2.0 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn test_value_penalty_compression() {
        // Values large enough to trigger compression (primary_penalty > 0.999)
        // 1/(1+1/v) > 0.999  =>  v > 999
        let p = value_penalty(1000.0);
        assert!(p >= 0.999);
        assert!(p < 1.0);

        let p2 = value_penalty(10_000.0);
        assert!(p2 >= 0.999);
        assert!(p2 < 1.0);
        assert!(p2 > p);
    }

    #[test]
    #[should_panic(expected = "negative")]
    fn test_value_penalty_rejects_negative() {
        value_penalty(-1.0);
    }

    #[test]
    fn test_calculate_penalty_symmetric() {
        let penalty = calculate_penalty(5.0, 2.0);
        let expected = (value_penalty(5.0) + value_penalty(2.0)) / 2.0;
        assert!((penalty - expected).abs() < 1e-12);
    }

    #[test]
    fn test_calculate_penalty_zero_for_small() {
        let penalty = calculate_penalty(0.5, 0.3);
        assert_eq!(penalty, 0.0);
    }

    #[test]
    fn test_squash_complexity_if_has_penalty() {
        assert_eq!(squash_complexity_penalty(SquashType::If), 3.0);
    }

    #[test]
    fn test_squash_complexity_standard_zero() {
        assert_eq!(squash_complexity_penalty(SquashType::Relu), 0.0);
        assert_eq!(squash_complexity_penalty(SquashType::Tanh), 0.0);
        assert_eq!(squash_complexity_penalty(SquashType::Logistic), 0.0);
        assert_eq!(squash_complexity_penalty(SquashType::Identity), 0.0);
    }

    #[test]
    fn test_calculate_score_perfect() {
        let components = ScoreComponents {
            hidden_neuron_count: 0,
            synapse_count: 2,
            max_weight_bias: 0.5,
            avg_weight_bias: 0.3,
            squash_complexity_penalty: 0.0,
        };
        // Error=0, version matched => score close to 1 (minus small synapse penalty)
        let score = calculate_score(0.0, &components, 0.0001, Some("4.0.0"));
        assert!(score > 0.99);
        assert!(score <= 1.0);
    }

    #[test]
    fn test_calculate_score_with_error() {
        let components = ScoreComponents {
            hidden_neuron_count: 0,
            synapse_count: 0,
            max_weight_bias: 0.5,
            avg_weight_bias: 0.3,
            squash_complexity_penalty: 0.0,
        };
        let score = calculate_score(0.5, &components, 0.0, Some("4.0.0"));
        assert!((score - 0.5).abs() < 1e-12);
    }

    #[test]
    fn test_version_penalty_applied() {
        let components = ScoreComponents {
            hidden_neuron_count: 0,
            synapse_count: 0,
            max_weight_bias: 0.5,
            avg_weight_bias: 0.3,
            squash_complexity_penalty: 0.0,
        };
        let score_v4 = calculate_score(0.0, &components, 0.0, Some("4.1.0"));
        let score_v3 = calculate_score(0.0, &components, 0.0, Some("3.0.0"));
        let score_none = calculate_score(0.0, &components, 0.0, None);

        assert!((score_v4 - 1.0).abs() < 1e-12);
        assert!((score_v3 - (1.0 - 1e-6)).abs() < 1e-12);
        assert!((score_none - (1.0 - 1e-6)).abs() < 1e-12);
    }

    #[test]
    fn test_complexity_penalty_formula() {
        let components = ScoreComponents {
            hidden_neuron_count: 10,
            synapse_count: 50,
            max_weight_bias: 0.5,
            avg_weight_bias: 0.3,
            squash_complexity_penalty: 0.0,
        };
        let growth_cost = 0.001;
        // Expected: 10 * 0.001 + 50 * 0.001 / 10 + 0 * 0.001 / 100
        //         = 0.01 + 0.005 + 0 = 0.015
        let score = calculate_score(0.0, &components, growth_cost, Some("4.0.0"));
        assert!((score - (1.0 - 0.015)).abs() < 1e-12);
    }

    #[test]
    fn test_score_components_from_creature() {
        let creature = CreatureExport {
            input: 2,
            output: 1,
            neurons: vec![
                neat_core::creature::NeuronExport {
                    neuron_type: "hidden".to_string(),
                    uuid: "hidden-0".to_string(),
                    bias: 0.5,
                    squash: Some("TANH".to_string()),
                },
                neat_core::creature::NeuronExport {
                    neuron_type: "output".to_string(),
                    uuid: "output-0".to_string(),
                    bias: -0.3,
                    squash: Some("LOGISTIC".to_string()),
                },
            ],
            synapses: vec![
                neat_core::creature::SynapseExport {
                    from_uuid: "input-0".to_string(),
                    to_uuid: "hidden-0".to_string(),
                    weight: 1.5,
                    synapse_type: None,
                },
                neat_core::creature::SynapseExport {
                    from_uuid: "input-1".to_string(),
                    to_uuid: "hidden-0".to_string(),
                    weight: -0.8,
                    synapse_type: None,
                },
                neat_core::creature::SynapseExport {
                    from_uuid: "hidden-0".to_string(),
                    to_uuid: "output-0".to_string(),
                    weight: 2.0,
                    synapse_type: None,
                },
            ],
            semantic_version: Some("4.1.0".to_string()),
        };

        let components = compute_score_components(&creature);
        assert_eq!(components.hidden_neuron_count, 1);
        assert_eq!(components.synapse_count, 3);
        // Max abs: max(1.5, 0.8, 2.0, 0.5, 0.3) = 2.0
        assert!((components.max_weight_bias - 2.0).abs() < 1e-12);
        // Total abs: 1.5 + 0.8 + 2.0 + 0.5 + 0.3 = 5.1, count = 5
        assert!((components.avg_weight_bias - 5.1 / 5.0).abs() < 1e-12);
        assert_eq!(components.squash_complexity_penalty, 0.0);
    }
}

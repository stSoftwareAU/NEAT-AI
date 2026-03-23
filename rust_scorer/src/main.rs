//! Rust CLI scorer for NEAT-AI creatures.
//!
//! Scores a creature against a training data directory, replicating the full
//! scoring pipeline from the TypeScript implementation.
//!
//! Issue #1967 - Build Rust CLI scorer application.

mod cost;
mod scoring;

use std::fs;
use std::process;

use clap::Parser;
use neat_core::creature::{compile_creature, parse_creature_json};
use neat_core::training_data::{find_bin_files, TrainingDataConfig};

use crate::cost::{CostFunction, calculate_cost};
use crate::scoring::{ScoreResult, calculate_score, compute_score_components};

/// NEAT-AI Creature Scorer - scores a creature against training data.
#[derive(Parser, Debug)]
#[command(name = "rust_scorer", about = "Score a NEAT-AI creature against training data")]
struct Cli {
    /// Path to the creature JSON file.
    #[arg(long)]
    creature: String,

    /// Path to the training data directory containing .bin files.
    #[arg(long)]
    data: String,

    /// Cost function name (MSE, MAE, CrossEntropy, MAPE, MSLE, HINGE).
    #[arg(long)]
    cost: String,

    /// Number of input neurons.
    #[arg(long)]
    inputs: usize,

    /// Number of output neurons.
    #[arg(long)]
    outputs: usize,

    /// Growth cost factor for complexity penalty.
    #[arg(long, default_value = "0.0001")]
    growth_cost: f64,
}

fn run(cli: &Cli) -> Result<ScoreResult, String> {
    // Validate inputs
    if cli.inputs == 0 {
        return Err("Number of inputs must be greater than 0".to_string());
    }
    if cli.outputs == 0 {
        return Err("Number of outputs must be greater than 0".to_string());
    }

    // Parse cost function
    let cost_fn = CostFunction::from_name(&cli.cost)?;

    // Read and parse creature JSON
    let creature_json = fs::read_to_string(&cli.creature)
        .map_err(|e| format!("Failed to read creature file '{}': {e}", cli.creature))?;
    let creature = parse_creature_json(&creature_json)?;

    // Validate dimensions match
    if creature.input != cli.inputs {
        return Err(format!(
            "Creature has {} inputs but --inputs={} was specified",
            creature.input, cli.inputs
        ));
    }
    if creature.output != cli.outputs {
        return Err(format!(
            "Creature has {} outputs but --outputs={} was specified",
            creature.output, cli.outputs
        ));
    }

    // Compile creature to network
    let mut network = compile_creature(&creature)?;
    let num_outputs = creature.output;

    // Read training data directory
    let data_path = std::path::Path::new(&cli.data);
    if !data_path.is_dir() {
        return Err(format!(
            "Training data path '{}' is not a directory",
            cli.data
        ));
    }

    let bin_files = find_bin_files(data_path)
        .map_err(|e| format!("Failed to read training data directory: {e}"))?;
    if bin_files.is_empty() {
        return Err(format!(
            "No .bin files found in training data directory '{}'",
            cli.data
        ));
    }

    let config = TrainingDataConfig {
        num_inputs: cli.inputs,
        num_outputs: cli.outputs,
    };

    // Score all records
    let mut total_error = 0.0_f64;
    let mut record_count: usize = 0;
    let mut output_buf = vec![0.0_f32; num_outputs];

    for bin_file in &bin_files {
        let records = neat_core::training_data::read_file(bin_file, &config)
            .map_err(|e| format!("Failed to read training file '{}': {e}", bin_file.display()))?;

        for record in &records {
            // Reset network state for stateless (feed-forward) activation
            network.reset_state();

            // Activate the network
            let outputs = network.activate(&record.inputs, num_outputs);
            output_buf.copy_from_slice(&outputs);

            // Calculate cost for this record
            let record_error = calculate_cost(cost_fn, &record.outputs, &output_buf);
            total_error += record_error;
            record_count += 1;
        }
    }

    if record_count == 0 {
        return Err("No training records found".to_string());
    }

    // Average error across all records
    let avg_error = total_error / record_count as f64;

    // Compute score components from the creature
    let components = compute_score_components(&creature);
    let hidden_neurons = components.hidden_neuron_count;
    let synapse_count = components.synapse_count;

    // Calculate the complexity penalty for the result
    let weight_bias_penalty =
        (scoring::value_penalty(components.max_weight_bias) + scoring::value_penalty(components.avg_weight_bias)) / 2.0;
    let total_penalty = weight_bias_penalty + components.squash_complexity_penalty;
    let complexity_penalty = hidden_neurons as f64 * cli.growth_cost
        + synapse_count as f64 * cli.growth_cost / 10.0
        + total_penalty * cli.growth_cost / 100.0;

    // Calculate final score
    let score = calculate_score(
        avg_error,
        &components,
        cli.growth_cost,
        creature.semantic_version.as_deref(),
    );

    Ok(ScoreResult {
        score,
        error: avg_error,
        complexity_penalty,
        record_count,
        hidden_neurons,
        synapse_count,
    })
}

fn main() {
    let cli = Cli::parse();

    match run(&cli) {
        Ok(result) => {
            let json = serde_json::to_string_pretty(&result)
                .expect("Failed to serialise result to JSON");
            println!("{json}");
        }
        Err(e) => {
            eprintln!("Error: {e}");
            process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    /// Helper: create a minimal creature JSON string.
    fn make_creature_json(
        num_inputs: usize,
        num_outputs: usize,
        hidden_neurons: &[(&str, &str, f64)], // (uuid, squash, bias)
        synapses: &[(&str, &str, f64)],        // (from, to, weight)
        version: Option<&str>,
    ) -> String {
        let mut neurons = Vec::new();

        for &(uuid, squash, bias) in hidden_neurons {
            neurons.push(format!(
                r#"{{"type":"hidden","uuid":"{uuid}","bias":{bias},"squash":"{squash}"}}"#
            ));
        }

        for i in 0..num_outputs {
            neurons.push(format!(
                r#"{{"type":"output","uuid":"output-{i}","bias":0.0,"squash":"IDENTITY"}}"#
            ));
        }

        let mut syn_strs = Vec::new();
        for &(from, to, weight) in synapses {
            syn_strs.push(format!(
                r#"{{"fromUUID":"{from}","toUUID":"{to}","weight":{weight}}}"#
            ));
        }

        let version_str = match version {
            Some(v) => format!(r#","semanticVersion":"{v}""#),
            None => String::new(),
        };

        format!(
            r#"{{"input":{num_inputs},"output":{num_outputs},"neurons":[{}],"synapses":[{}]{version_str}}}"#,
            neurons.join(","),
            syn_strs.join(","),
        )
    }

    /// Helper: write training records as binary files.
    fn write_training_data(
        dir: &std::path::Path,
        records: &[(Vec<f32>, Vec<f32>)], // (inputs, outputs)
    ) {
        let mut file = fs::File::create(dir.join("0.bin")).unwrap();
        for (inputs, outputs) in records {
            for &v in inputs.iter().chain(outputs.iter()) {
                file.write_all(&v.to_le_bytes()).unwrap();
            }
        }
    }

    #[test]
    fn test_identity_network_zero_error() {
        // A simple network: input-0 -> output-0 with weight=1, bias=0
        // When given input=X, output should be X, so error against target=X is 0
        let tmp = TempDir::new().unwrap();
        let creature_path = tmp.path().join("creature.json");
        let data_dir = tmp.path().join("data");
        fs::create_dir(&data_dir).unwrap();

        let json = make_creature_json(
            1,
            1,
            &[],
            &[("input-0", "output-0", 1.0)],
            Some("4.0.0"),
        );
        fs::write(&creature_path, &json).unwrap();

        // Training data: input=0.5, expected output=0.5
        write_training_data(&data_dir, &[(vec![0.5], vec![0.5])]);

        let cli = Cli {
            creature: creature_path.to_string_lossy().to_string(),
            data: data_dir.to_string_lossy().to_string(),
            cost: "MSE".to_string(),
            inputs: 1,
            outputs: 1,
            growth_cost: 0.0,
        };

        let result = run(&cli).unwrap();
        assert!(
            result.error.abs() < 1e-6,
            "Expected near-zero error, got {}",
            result.error
        );
        assert!(
            (result.score - 1.0).abs() < 1e-6,
            "Expected score near 1.0, got {}",
            result.score
        );
        assert_eq!(result.record_count, 1);
    }

    #[test]
    fn test_score_with_hidden_neuron() {
        let tmp = TempDir::new().unwrap();
        let creature_path = tmp.path().join("creature.json");
        let data_dir = tmp.path().join("data");
        fs::create_dir(&data_dir).unwrap();

        let json = make_creature_json(
            1,
            1,
            &[("hidden-0", "TANH", 0.0)],
            &[
                ("input-0", "hidden-0", 1.0),
                ("hidden-0", "output-0", 1.0),
            ],
            Some("4.0.0"),
        );
        fs::write(&creature_path, &json).unwrap();

        // Input=0 => tanh(0) = 0 => output = 0
        write_training_data(&data_dir, &[(vec![0.0], vec![0.0])]);

        let cli = Cli {
            creature: creature_path.to_string_lossy().to_string(),
            data: data_dir.to_string_lossy().to_string(),
            cost: "MSE".to_string(),
            inputs: 1,
            outputs: 1,
            growth_cost: 0.0001,
        };

        let result = run(&cli).unwrap();
        assert!(
            result.error.abs() < 1e-6,
            "Expected near-zero error, got {}",
            result.error
        );
        assert_eq!(result.hidden_neurons, 1);
        assert_eq!(result.synapse_count, 2);
        assert!(result.complexity_penalty > 0.0);
    }

    #[test]
    fn test_multiple_records() {
        let tmp = TempDir::new().unwrap();
        let creature_path = tmp.path().join("creature.json");
        let data_dir = tmp.path().join("data");
        fs::create_dir(&data_dir).unwrap();

        // Identity network: output = input
        let json = make_creature_json(
            1,
            1,
            &[],
            &[("input-0", "output-0", 1.0)],
            Some("4.0.0"),
        );
        fs::write(&creature_path, &json).unwrap();

        // Multiple records with some error
        write_training_data(
            &data_dir,
            &[
                (vec![1.0], vec![1.0]),   // perfect
                (vec![0.0], vec![0.0]),   // perfect
                (vec![0.5], vec![0.5]),   // perfect
            ],
        );

        let cli = Cli {
            creature: creature_path.to_string_lossy().to_string(),
            data: data_dir.to_string_lossy().to_string(),
            cost: "MSE".to_string(),
            inputs: 1,
            outputs: 1,
            growth_cost: 0.0,
        };

        let result = run(&cli).unwrap();
        assert_eq!(result.record_count, 3);
        assert!(result.error.abs() < 1e-6);
    }

    #[test]
    fn test_dimension_mismatch_creature_inputs() {
        let tmp = TempDir::new().unwrap();
        let creature_path = tmp.path().join("creature.json");
        let data_dir = tmp.path().join("data");
        fs::create_dir(&data_dir).unwrap();

        let json = make_creature_json(2, 1, &[], &[("input-0", "output-0", 1.0)], None);
        fs::write(&creature_path, &json).unwrap();
        write_training_data(&data_dir, &[(vec![0.5, 0.5], vec![0.5])]);

        let cli = Cli {
            creature: creature_path.to_string_lossy().to_string(),
            data: data_dir.to_string_lossy().to_string(),
            cost: "MSE".to_string(),
            inputs: 3, // mismatch
            outputs: 1,
            growth_cost: 0.0001,
        };

        let result = run(&cli);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("inputs"));
    }

    #[test]
    fn test_invalid_cost_function() {
        let tmp = TempDir::new().unwrap();
        let creature_path = tmp.path().join("creature.json");
        let data_dir = tmp.path().join("data");
        fs::create_dir(&data_dir).unwrap();

        let json = make_creature_json(1, 1, &[], &[("input-0", "output-0", 1.0)], None);
        fs::write(&creature_path, &json).unwrap();
        write_training_data(&data_dir, &[(vec![0.5], vec![0.5])]);

        let cli = Cli {
            creature: creature_path.to_string_lossy().to_string(),
            data: data_dir.to_string_lossy().to_string(),
            cost: "INVALID".to_string(),
            inputs: 1,
            outputs: 1,
            growth_cost: 0.0001,
        };

        let result = run(&cli);
        assert!(result.is_err());
    }

    #[test]
    fn test_missing_creature_file() {
        let cli = Cli {
            creature: "/nonexistent/path/creature.json".to_string(),
            data: "/tmp".to_string(),
            cost: "MSE".to_string(),
            inputs: 1,
            outputs: 1,
            growth_cost: 0.0001,
        };

        let result = run(&cli);
        assert!(result.is_err());
    }

    #[test]
    fn test_version_penalty_in_score() {
        let tmp = TempDir::new().unwrap();
        let creature_path_v4 = tmp.path().join("creature_v4.json");
        let creature_path_v3 = tmp.path().join("creature_v3.json");
        let data_dir = tmp.path().join("data");
        fs::create_dir(&data_dir).unwrap();

        let json_v4 = make_creature_json(
            1,
            1,
            &[],
            &[("input-0", "output-0", 1.0)],
            Some("4.0.0"),
        );
        let json_v3 = make_creature_json(
            1,
            1,
            &[],
            &[("input-0", "output-0", 1.0)],
            Some("3.0.0"),
        );
        fs::write(&creature_path_v4, &json_v4).unwrap();
        fs::write(&creature_path_v3, &json_v3).unwrap();
        write_training_data(&data_dir, &[(vec![0.5], vec![0.5])]);

        let cli_v4 = Cli {
            creature: creature_path_v4.to_string_lossy().to_string(),
            data: data_dir.to_string_lossy().to_string(),
            cost: "MSE".to_string(),
            inputs: 1,
            outputs: 1,
            growth_cost: 0.0,
        };
        let cli_v3 = Cli {
            creature: creature_path_v3.to_string_lossy().to_string(),
            data: data_dir.to_string_lossy().to_string(),
            cost: "MSE".to_string(),
            inputs: 1,
            outputs: 1,
            growth_cost: 0.0,
        };

        let result_v4 = run(&cli_v4).unwrap();
        let result_v3 = run(&cli_v3).unwrap();

        // v3 should have a 1e-6 version penalty
        assert!(
            (result_v4.score - result_v3.score - 1e-6).abs() < 1e-10,
            "Version penalty difference should be 1e-6, v4={}, v3={}",
            result_v4.score,
            result_v3.score
        );
    }

    #[test]
    fn test_all_cost_functions_run() {
        let tmp = TempDir::new().unwrap();
        let creature_path = tmp.path().join("creature.json");
        let data_dir = tmp.path().join("data");
        fs::create_dir(&data_dir).unwrap();

        // Use logistic activation to keep output in (0,1) for CrossEntropy
        let json = make_creature_json(
            1,
            1,
            &[],
            &[("input-0", "output-0", 0.5)],
            Some("4.0.0"),
        );
        fs::write(&creature_path, &json).unwrap();

        // Target in (0,1) range for CrossEntropy compatibility
        write_training_data(&data_dir, &[(vec![0.5], vec![0.5])]);

        for cost_name in &["MSE", "MAE", "CrossEntropy", "MAPE", "MSLE", "HINGE"] {
            let cli = Cli {
                creature: creature_path.to_string_lossy().to_string(),
                data: data_dir.to_string_lossy().to_string(),
                cost: cost_name.to_string(),
                inputs: 1,
                outputs: 1,
                growth_cost: 0.0001,
            };

            let result = run(&cli);
            assert!(
                result.is_ok(),
                "Cost function {cost_name} failed: {:?}",
                result.err()
            );
        }
    }

    #[test]
    fn test_empty_data_directory() {
        let tmp = TempDir::new().unwrap();
        let creature_path = tmp.path().join("creature.json");
        let data_dir = tmp.path().join("data");
        fs::create_dir(&data_dir).unwrap();

        let json = make_creature_json(1, 1, &[], &[("input-0", "output-0", 1.0)], None);
        fs::write(&creature_path, &json).unwrap();

        let cli = Cli {
            creature: creature_path.to_string_lossy().to_string(),
            data: data_dir.to_string_lossy().to_string(),
            cost: "MSE".to_string(),
            inputs: 1,
            outputs: 1,
            growth_cost: 0.0001,
        };

        let result = run(&cli);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No .bin files"));
    }

    #[test]
    fn test_json_output_format() {
        let result = ScoreResult {
            score: 0.85,
            error: 0.12,
            complexity_penalty: 0.03,
            record_count: 5000,
            hidden_neurons: 150,
            synapse_count: 2000,
        };
        let json = serde_json::to_string_pretty(&result).unwrap();
        // Verify camelCase keys in output
        assert!(json.contains("\"score\""));
        assert!(json.contains("\"error\""));
        assert!(json.contains("\"complexityPenalty\""));
        assert!(json.contains("\"recordCount\""));
        assert!(json.contains("\"hiddenNeurons\""));
        assert!(json.contains("\"synapseCount\""));
    }
}

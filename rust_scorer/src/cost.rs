//! Cost function dispatch for the CLI scorer.
//!
//! Wraps the per-output cost calculation matching the TypeScript implementations
//! in `src/costs/`. Each function takes target and output slices and returns
//! the mean error.
//!
//! Issue #1967 - Build Rust CLI scorer application.

/// Supported cost function names.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CostFunction {
    Mse,
    Mae,
    CrossEntropy,
    Mape,
    Msle,
    Hinge,
}

impl CostFunction {
    /// Parse a cost function name from a CLI string (case-insensitive).
    pub fn from_name(name: &str) -> Result<Self, String> {
        match name.to_uppercase().as_str() {
            "MSE" => Ok(CostFunction::Mse),
            "MAE" => Ok(CostFunction::Mae),
            "CROSSENTROPY" | "CROSS_ENTROPY" => Ok(CostFunction::CrossEntropy),
            "MAPE" => Ok(CostFunction::Mape),
            "MSLE" => Ok(CostFunction::Msle),
            "HINGE" => Ok(CostFunction::Hinge),
            _ => Err(format!(
                "Unknown cost function: {name}. \
                 Supported: MSE, MAE, CrossEntropy, MAPE, MSLE, HINGE"
            )),
        }
    }
}

/// Calculate the cost (error) between target and output arrays.
///
/// Matches the TypeScript `CostInterface.calculate()` implementations.
/// Returns the mean error across all outputs.
pub fn calculate_cost(cost: CostFunction, target: &[f32], output: &[f32]) -> f64 {
    assert_eq!(
        target.len(),
        output.len(),
        "Target and output length mismatch"
    );
    let len = output.len();
    assert!(len > 0, "Empty target/output arrays");

    match cost {
        CostFunction::Mse => {
            let mut error = 0.0_f64;
            for i in 0..len {
                let diff = (target[i] - output[i]) as f64;
                error += diff * diff;
            }
            error / len as f64
        }
        CostFunction::Mae => {
            let mut error = 0.0_f64;
            for i in 0..len {
                error += ((target[i] - output[i]) as f64).abs();
            }
            error / len as f64
        }
        CostFunction::CrossEntropy => {
            let mut error = 0.0_f64;
            for i in 0..len {
                let t = target[i] as f64;
                let o = (output[i] as f64).clamp(1e-15, 1.0 - 1e-15);
                error -= t * o.ln() + (1.0 - t) * (1.0 - o).ln();
            }
            error / len as f64
        }
        CostFunction::Mape => {
            let mut error = 0.0_f64;
            for i in 0..len {
                let t = (target[i] as f64).max(1e-15);
                let o = output[i] as f64;
                error += ((o - t) / t).abs();
            }
            error / len as f64
        }
        CostFunction::Msle => {
            // Matches TS: sum of (log(target) - log(output)) without division by len
            let mut error = 0.0_f64;
            for i in 0..len {
                let t = (target[i] as f64).max(1e-15);
                let o = (output[i] as f64).max(1e-15);
                error += t.ln() - o.ln();
            }
            error
        }
        CostFunction::Hinge => {
            // Matches TS: sum of max(0, 1 - t*o) without division by len
            let mut error = 0.0_f64;
            for i in 0..len {
                let t = target[i] as f64;
                let o = output[i] as f64;
                error += (1.0 - t * o).max(0.0);
            }
            error
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cost_function_parsing() {
        assert_eq!(CostFunction::from_name("MSE").unwrap(), CostFunction::Mse);
        assert_eq!(CostFunction::from_name("mse").unwrap(), CostFunction::Mse);
        assert_eq!(CostFunction::from_name("MAE").unwrap(), CostFunction::Mae);
        assert_eq!(
            CostFunction::from_name("CrossEntropy").unwrap(),
            CostFunction::CrossEntropy
        );
        assert_eq!(
            CostFunction::from_name("CROSS_ENTROPY").unwrap(),
            CostFunction::CrossEntropy
        );
        assert_eq!(
            CostFunction::from_name("MAPE").unwrap(),
            CostFunction::Mape
        );
        assert_eq!(
            CostFunction::from_name("MSLE").unwrap(),
            CostFunction::Msle
        );
        assert_eq!(
            CostFunction::from_name("HINGE").unwrap(),
            CostFunction::Hinge
        );
        assert!(CostFunction::from_name("UNKNOWN").is_err());
    }

    #[test]
    fn test_mse_perfect_prediction() {
        let target = [1.0_f32, 2.0, 3.0];
        let output = [1.0_f32, 2.0, 3.0];
        let error = calculate_cost(CostFunction::Mse, &target, &output);
        assert!((error - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_mse_known_value() {
        // MSE of [1, 2, 3] vs [0.9, 2.1, 2.8]
        // diffs: 0.1, -0.1, 0.2 => squares: 0.01, 0.01, 0.04 => mean: 0.06/3 = 0.02
        let target = [1.0_f32, 2.0, 3.0];
        let output = [0.9_f32, 2.1, 2.8];
        let error = calculate_cost(CostFunction::Mse, &target, &output);
        assert!((error - 0.02).abs() < 1e-6);
    }

    #[test]
    fn test_mae_known_value() {
        // MAE: |0.1| + |0.1| + |0.2| = 0.4 / 3 ≈ 0.1333
        let target = [1.0_f32, 2.0, 3.0];
        let output = [0.9_f32, 2.1, 2.8];
        let error = calculate_cost(CostFunction::Mae, &target, &output);
        assert!((error - 0.4 / 3.0).abs() < 1e-6);
    }

    #[test]
    fn test_cross_entropy_known_value() {
        // Binary cross entropy for a single output: -[1*ln(0.9) + 0*ln(0.1)] = -ln(0.9)
        let target = [1.0_f32];
        let output = [0.9_f32];
        let error = calculate_cost(CostFunction::CrossEntropy, &target, &output);
        let expected = -(0.9_f64.ln());
        assert!((error - expected).abs() < 1e-6);
    }

    #[test]
    fn test_hinge_correct_prediction() {
        // target=1, output=2 => max(0, 1 - 1*2) = max(0, -1) = 0
        let target = [1.0_f32];
        let output = [2.0_f32];
        let error = calculate_cost(CostFunction::Hinge, &target, &output);
        assert!((error - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_hinge_wrong_prediction() {
        // target=1, output=-0.5 => max(0, 1 - 1*(-0.5)) = max(0, 1.5) = 1.5
        let target = [1.0_f32];
        let output = [-0.5_f32];
        let error = calculate_cost(CostFunction::Hinge, &target, &output);
        assert!((error - 1.5).abs() < 1e-6);
    }

    #[test]
    fn test_mape_known_value() {
        // MAPE: |(95-100)/100| + |(210-200)/200| + |(285-300)/300| = 0.05 + 0.05 + 0.05 = 0.15 / 3 = 0.05
        let target = [100.0_f32, 200.0, 300.0];
        let output = [95.0_f32, 210.0, 285.0];
        let error = calculate_cost(CostFunction::Mape, &target, &output);
        assert!((error - 0.05).abs() < 1e-6);
    }

    #[test]
    fn test_msle_perfect_prediction() {
        let target = [1.0_f32, 2.0, 3.0];
        let output = [1.0_f32, 2.0, 3.0];
        let error = calculate_cost(CostFunction::Msle, &target, &output);
        assert!((error - 0.0).abs() < 1e-10);
    }
}

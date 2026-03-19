import type { BackPropagationArguments } from "../propagate/BackPropagation.ts";
import type { CrossValidationConfig } from "./CrossValidationConfig.ts";
import type { DataFuzzingConfig } from "./DataFuzzingConfig.ts";
import type { PredictiveCodingConfig } from "./PredictiveCodingConfig.ts";

export interface TrainArguments extends BackPropagationArguments {
  /** If set to n, will output the training status every n iterations (log : 1 will log every iteration) */
  log: number;

  /** The target error to reach, once the network falls below this error, the process is stopped. Default: 0.05, Range 0..1 */
  targetError: number;

  /**
   * Sets the amount of iterations the process will maximally run,
   * even when the target error has not been reached. Default: 2
   *
   * Note: Need to run at least 2 iterations to allow rollback if training makes the network worse.
   */
  iterations: number;

  /** The directory to store the networks trace information (optional) */
  traceStore?: string;

  /** The percentage of observations that will be used for training. Range 0..1 */
  trainingSampleRate: number;

  /** The maximum number of minutes to train for */
  trainingTimeOutMinutes: number;

  /**
   * Enable feedback loop where the previous result feeds back into the next interaction.
   * Useful for time-series forecasting and recurrent neural networks.
   * More information: https://www.mathworks.com/help/deeplearning/ug/design-time-series-narx-feedback-neural-networks.html
   */
  feedbackLoop: boolean;

  /**
   * Predictive Coding configuration.
   *
   * Issue #1556: When predictiveCoding.enabled is true, training uses
   * local Hebbian learning rules driven by prediction error minimisation
   * instead of standard backpropagation.
   */
  predictiveCoding: PredictiveCodingConfig;

  /**
   * Cross-validation configuration.
   *
   * Issue #1865: When enabled, training data is split into k folds.
   * The creature is trained on k-1 folds and validated on the held-out
   * fold. Fitness is the average validation error across all folds.
   */
  crossValidation: CrossValidationConfig;

  /**
   * Data fuzzing (noise injection) configuration.
   *
   * Issue #1900: When enabled, small random perturbations are added
   * to training data each iteration to prevent memorisation.
   */
  dataFuzzing: DataFuzzingConfig;
}

export type TrainOptions = Partial<TrainArguments>;

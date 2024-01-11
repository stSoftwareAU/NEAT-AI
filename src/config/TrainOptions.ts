import { BackPropagationOptions } from "../architecture/BackPropagation.ts";

export interface TrainOptions extends BackPropagationOptions {
  /** If set to n, will output the training status every n iterations (log : 1 will log every iteration) */
  log?: number;

  /** The target error to reach, once the network falls below this error, the process is stopped. Default: 0.05, Range 0..1 */
  targetError?: number;

  /** The cost function to use. See cost methods. Default: methods.cost.MSE */
  cost?: string;

  /**
   * Sets the amount of iterations the process will maximally run,
   * even when the target error has not been reached. Default: 2
   *
   * Note: Need to run at least 2 iterations to allow rollback if training makes the network worse.
   */
  iterations?: number;

  /** The directory to store the networks trace information (optional) */
  traceStore?: string;

  /** The percentage of observations that will be used for training. Range 0..1 */
  trainingSampleRate?: number;
}

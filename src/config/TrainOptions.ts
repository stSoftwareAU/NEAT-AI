export interface TrainOptions {
  /** If set to n, will output the training status every n iterations (log : 1 will log every iteration) */
  log?: number;

  /** The target error to reach, once the network falls below this error, the process is stopped. Default: 0.03 */
  error?: number;

  /** The cost function to use. See cost methods. Default: methods.cost.MSE */
  cost?: string;

  /** Sets the learning rate of the back propagation process. Default: 0.3. */
  rate?: number;

  /** Sets the amount of iterations the process will maximally run, even when the target error has not been reached. Default: NaN */
  iterations?: number;

  /** Sets the rate policy for your training. This allows your rate to be dynamic, see the rate policies page. Default: methods.rate.FIXED() */
  ratePolicy?: string;

  /** Sets the (mini-) batch size of your training. Default: 1 (online training) */
  batchSize?: number;
}

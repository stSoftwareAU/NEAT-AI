/**
 * Per-node state used during Predictive Coding inference.
 *
 * Issue #1553: Each neuron participating in the PC inference loop
 * maintains a prediction, error, and latent value that are iteratively
 * updated until convergence.
 *
 * - prediction: top-down prediction x̂(l) = f(W · x(l+1))
 * - error:      prediction error ε(l) = x(l) - x̂(l)
 * - latent:     current latent value x(l) during inference
 */
export interface PredictionNodeState {
  /** Top-down prediction x̂(l) = f(W · x(l+1)). */
  prediction: number;

  /** Prediction error ε(l) = x(l) - x̂(l). */
  error: number;

  /** Current latent value x(l) during inference. */
  latent: number;
}

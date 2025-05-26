import type { ActivationRange } from "../../propagate/ActivationRange.ts";

/**
 * Smallest meaningful difference between target and actual activation.
 *
 * Used to short-circuit `calculateError()` for near-zero error cases.
 *
 * Why 1e-6?
 * - Neural network activations are usually in the range [-1, 1].
 * - Differences smaller than 1e-6 are often due to floating-point noise.
 * - Skipping computation for these tiny errors improves speed and stability.
 * - JS uses IEEE 64-bit floats, where 1e-6 is well above numerical precision limits (~1e-15).
 *
 * Safe for:
 * - Most modern networks using ReLU, GELU, Mish, etc.
 * - Any derivative- or unSquash-based error propagation where fine precision is not critical.
 */
export const ERROR_EPSILON = 1e-6;

export interface AbstractActivationInterface {
  getName(): string;
  readonly range: ActivationRange;
  derivative?(value: number): number;
  calculateError?(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number;
  complexityPenalty?: number;

  mutationProbability: number;

  /**
   * NEED Safe Zone Logic
   * These functions can explode, vanish, or otherwise make backprop unstable or ineffective in certain raw input ranges:
   *
   * Squash	            Reason
   * -----------------	-------------------------------------------------------------
   * Exponential	      Explodes > 36, vanishes < -10
   * LOGISTIC	          Flat outside [-6, 6]
   * TANH	              Flat outside [-4, 4]
   * Hard_TANH	        Hard cutoff outside [-1, 1]
   * ReLU	              Dead when x ≤ 0
   * ReLU6	            Dead x ≤ 0, saturated x ≥ 6
   *
   * Softplus	          Flat when x ≪ 0
   * GELU	              Saturation on both ends
   * Mish	              Explodes or saturates on extremes
   * Swish            	Mild vanishing at low x, sometimes unstable
   * ELU	              Nonlinear tail for x < 0
   * SELU	              Same as ELU but with scaling
   * LeakyReLU	        Small gradient x < 0; safe but asymmetry may matter
   * ISRU             	Division by sqrt-like term — flattens at high abs(x)
   * GAUSSIAN	          Only sensitive around x ≈ 0
   */
  safeZoneAdjustment?(
    rawInput: number,
    error: number,
  ): number;
}

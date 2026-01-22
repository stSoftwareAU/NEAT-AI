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
  /**
   * Optional hint for WASM forward activation:
   * treat this activation as an alias of another activation name that *is*
   * supported by WASM.
   *
   * This is useful for wrapper activations used for recording/debugging
   * (e.g. tests) that should behave identically during the forward pass.
   */
  wasmAliasName?(): string;
  complexityPenalty?: number;

  mutationProbability: number;

  /**
   * NEED Safe Zone Logic
   * These functions can explode, vanish, or otherwise make backprop unstable or ineffective in certain raw input ranges:
   *
   * Squash	            Reason                                                        Weight Logic
   * -----------------	------------------------------------------------------------- -----------------
   * Exponential	      Explodes > 36, vanishes < -10                                 ✅ Unbounded ↑ — risk of overflow and useless gradients in large x
   * LOGISTIC	          Flat outside [-6, 6]
   * TANH	              Flat outside [-4, 4]
   * Hard_TANH	        Hard cutoff outside [-1, 1]
   * ReLU	              Dead when x ≤ 0
   * ReLU6	            Dead x ≤ 0, saturated x ≥ 6
   *
   * Softplus	          Flat when x ≪ 0                                              ✅ Flattening on left side; large x may lead to stability loss
   * GELU	              Saturation on both ends
   * Mish	              Explodes or saturates on extremes                            ✅ Explodes for large x, vanishes for small x
   * Swish            	Mild vanishing at low x, sometimes unstable                  ✅ Tails flatten → large x needs weight consideration
   * ELU	              Nonlinear tail for x < 0                                     ✅ Unbounded ↑, soft flattening ↓
   * SELU	              Same as ELU but with scaling                                 ✅ Same as ELU — scaled but similar behavior
   * LeakyReLU	        Small gradient x < 0; safe but asymmetry may matter
   * ISRU             	Division by sqrt-like term — flattens at high abs(x)         ✅ Bounded output, but gradient vanishes at large
   * GAUSSIAN	          Only sensitive around x ≈ 0                                  ✅ Rapid falloff in gradient beyond
   */
  safeZoneAdjustment?(
    rawInput: number,
    error: number,
    weight: number,
  ): number;

  verbose?: boolean;
}

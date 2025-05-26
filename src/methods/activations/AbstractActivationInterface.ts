import type { ActivationRange } from "../../propagate/ActivationRange.ts";
import type { BackPropagationConfig } from "../../propagate/BackPropagation.ts";

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
  safeZoneAdjustment?(
    rawInput: number,
    config: BackPropagationConfig,
    error: number,
  ): number;
}

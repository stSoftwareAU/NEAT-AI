/**
 * Gradient hint for informing quantum adjustments.
 *
 * During fine-tuning, gradient information from the elastic backpropagation
 * system can optionally bias the direction and magnitude of quantum
 * adjustments. This provides a hybrid approach: gradient-informed direction
 * combined with random magnitude for exploration.
 *
 * The gradient direction is derived from the difference between current
 * and previous parameter values, while magnitude is normalised based on
 * the relative change. This lets fine-tuning leverage the direction of
 * recent improvement without requiring a full backpropagation pass.
 *
 * Australian English: behaviour, optimise, normalise.
 */

/**
 * Represents gradient information for a single parameter (weight or bias).
 * Used to bias quantum adjustments towards the gradient-informed direction.
 */
export interface GradientHint {
  /**
   * The direction the gradient suggests this parameter should move.
   * +1 = increase, -1 = decrease, 0 = no gradient information.
   */
  readonly direction: number;

  /**
   * The magnitude of the gradient, normalised to [0, 1].
   * Higher values indicate stronger gradient signals.
   * 0 means no gradient information is available.
   */
  readonly magnitude: number;
}

/**
 * Applies a gradient hint to bias the direction of a quantum adjustment delta.
 *
 * The gradient hint biases the adjustment direction without eliminating
 * randomness. When the random delta opposes the gradient direction,
 * there is a probability (proportional to gradient magnitude) that the
 * delta will be flipped to align with the gradient.
 *
 * @param delta - The randomly generated delta from quantum adjustment.
 * @param hint - The gradient hint providing direction and magnitude.
 * @param random - Optional random value for testability (0-1). Defaults to Math.random().
 * @returns The adjusted delta, potentially flipped to align with gradient direction.
 */
export function applyGradientBias(
  delta: number,
  hint: GradientHint,
  random?: number,
): number {
  // No hint direction means no adjustment
  if (hint.direction === 0 || hint.magnitude === 0) {
    return delta;
  }

  // If delta is zero, nothing to bias
  if (delta === 0) {
    return delta;
  }

  const deltaSign = Math.sign(delta);
  const gradientSign = Math.sign(hint.direction);

  // If already aligned with gradient, optionally amplify by magnitude
  if (deltaSign === gradientSign) {
    // Boost magnitude slightly when aligned: scale by (1 + magnitude * 0.5)
    // This gives up to 50% extra magnitude when gradient is strong and aligned
    return delta * (1 + hint.magnitude * 0.5);
  }

  // Delta opposes gradient direction - probabilistically flip it
  // The probability of flipping increases with gradient magnitude
  const flipProbability = hint.magnitude * 0.7; // Max 70% chance to flip
  const effectiveRandom = random ?? Math.random();

  if (effectiveRandom < flipProbability) {
    // Flip delta to align with gradient direction
    return -delta;
  }

  // Keep original delta (maintaining exploration)
  return delta;
}

/**
 * Computes a gradient hint from the difference between current and previous
 * parameter values, plus the score improvement.
 *
 * The direction is the sign of the parameter change (the direction that
 * produced improvement). The magnitude is derived from the score improvement,
 * normalised using the formula: |Δscore| / (1 + |Δscore|) to keep it in [0, 1).
 *
 * @param currentValue - The current parameter value (from the fitter creature).
 * @param previousValue - The previous parameter value.
 * @param scoreImprovement - The score improvement (currentScore - previousScore). Positive means improvement.
 * @returns A GradientHint, or undefined if there is no meaningful change.
 */
export function computeGradientHint(
  currentValue: number,
  previousValue: number,
  scoreImprovement: number,
): GradientHint | undefined {
  const paramDelta = currentValue - previousValue;

  // No parameter change means no gradient information
  if (paramDelta === 0) {
    return undefined;
  }

  // Only provide gradient hints when there was score improvement
  // (positive scoreImprovement means the score got better/less negative)
  if (scoreImprovement <= 0) {
    return undefined;
  }

  // Direction: the sign of the parameter change that led to improvement
  const direction = Math.sign(paramDelta);

  // Magnitude: normalised from score improvement
  // Uses the same normalisation as calculateEffectiveStep: |x| / (1 + |x|)
  const absImprovement = Math.abs(scoreImprovement);
  const magnitude = absImprovement / (1 + absImprovement);

  return { direction, magnitude };
}

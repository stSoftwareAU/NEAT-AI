/**
 * Issue #1471 - Bias-weight coordination for backpropagation.
 *
 * During backpropagation, bias and weight updates are computed
 * independently. When these updates have opposing net effects on the
 * neuron's pre-activation value, they can cancel out, wasting gradient
 * computation. This module detects such opposing effects and reduces
 * both changes proportionally to eliminate the cancellation while
 * preserving the net effect direction.
 *
 * The key insight is that the actual effect of a weight change depends
 * on the activation of the source neuron: Δeffect = Δweight × activation.
 * Comparing raw weight deltas with bias deltas would be incorrect because
 * they operate in different units. Instead, we compare bias delta against
 * the sum of (weight delta × activation) across all synapses.
 *
 * Coordination only triggers when the opposing magnitudes are close
 * enough to risk significant cancellation (ratio >= 0.95).
 *
 * Australian English: behaviour, optimise, normalise.
 */

/**
 * The minimum ratio (smaller / larger) of opposing effect magnitudes
 * required before coordination is applied. At 0.95, coordination
 * triggers only when the smaller opposing effect is at least 95% of
 * the larger — i.e. when near-total cancellation would occur.
 *
 * A very conservative threshold avoids interfering with gradient
 * updates where the opposing forces are unequal enough to still
 * produce a meaningful net change. Only near-perfect cancellation
 * (where >95% of the update is wasted) triggers coordination.
 */
const CANCELLATION_THRESHOLD = 0.95;

/**
 * Coordinates bias and weight updates from backpropagation to prevent
 * opposing changes from cancelling each other out.
 *
 * When near-perfect cancellation is detected, both the bias and weight
 * changes are reduced proportionally by the reductionFactor. This
 * avoids the asymmetry problem where reducing only one side could
 * push the neuron in the wrong direction during early training.
 *
 * @param currentBias - The neuron's current bias before update
 * @param candidateBias - The bias calculated by backprop
 * @param currentWeights - Array of current synapse weights
 * @param candidateWeights - Array of candidate weights from backprop
 * @param activations - Array of source neuron activations for each synapse
 * @param reductionFactor - How much of the opposing changes to
 *   keep (0..1). Default 0.2 matches fine-tuning coordination.
 * @returns Coordinated bias and weight values
 */
export function coordinateBackpropUpdates(
  currentBias: number,
  candidateBias: number,
  currentWeights: readonly number[],
  candidateWeights: readonly number[],
  activations: readonly number[],
  reductionFactor: number,
): { bias: number; weights: number[] } {
  const biasDelta = candidateBias - currentBias;
  const biasChanged = biasDelta !== 0;

  // Compute weight deltas and the net effect on pre-activation value
  const weightDeltas: number[] = [];
  let anyWeightChanged = false;
  let netWeightEffect = 0;
  for (let i = 0; i < currentWeights.length; i++) {
    const delta = candidateWeights[i] - currentWeights[i];
    weightDeltas.push(delta);
    if (delta !== 0) {
      anyWeightChanged = true;
      // The actual effect of this weight change on the neuron's
      // pre-activation value is delta × activation
      netWeightEffect += delta * activations[i];
    }
  }

  // No coordination needed if only one side changed (or neither)
  if (!biasChanged || !anyWeightChanged) {
    return {
      bias: candidateBias,
      weights: candidateWeights.slice() as number[],
    };
  }

  // Check if bias delta and net weight effect oppose each other
  const biasSign = Math.sign(biasDelta);
  const effectSign = Math.sign(netWeightEffect);

  if (biasSign !== 0 && effectSign !== 0 && biasSign === -effectSign) {
    const biasAbs = Math.abs(biasDelta);
    const effectAbs = Math.abs(netWeightEffect);
    const smaller = Math.min(biasAbs, effectAbs);
    const larger = Math.max(biasAbs, effectAbs);

    // Only coordinate when the smaller opposing force is significant
    // relative to the larger — i.e. when cancellation would waste
    // a meaningful portion of the gradient update.
    // Use a small epsilon for floating-point comparison tolerance.
    const EPSILON = 1e-10;
    if (
      larger > 0 &&
      (smaller / larger) >= CANCELLATION_THRESHOLD - EPSILON
    ) {
      // Reduce both sides proportionally to eliminate cancellation
      // without creating asymmetry that could push the neuron in
      // the wrong direction during early training.
      const adjustedWeights = currentWeights.map((w, i) => {
        const delta = weightDeltas[i];
        if (delta === 0) return w;
        return w + delta * reductionFactor;
      });
      return {
        bias: currentBias + biasDelta * reductionFactor,
        weights: adjustedWeights,
      };
    }
  }

  // Aligned, one side is zero, or opposing but not close enough to
  // risk significant cancellation — pass through unchanged.
  return {
    bias: candidateBias,
    weights: candidateWeights.slice() as number[],
  };
}

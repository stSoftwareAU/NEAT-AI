/**
 * Bias-weight coordination for quantum adjustments.
 *
 * For a neuron: v = b + Σ(w_i * a_i), so changes to bias (Δb) and
 * weights (Δw) can produce the same net effect or cancel each other out.
 * This module coordinates bias and weight adjustments to ensure changes
 * produce meaningful net effects rather than redundant or cancelling changes.
 *
 * Uses an elastic distribution principle: the desired net change is
 * distributed between bias and weights based on the magnitude of each
 * candidate change, ensuring both contribute proportionally.
 *
 * Australian English: behaviour, optimise, normalise.
 */

/**
 * Describes a synapse's adjustment plan for coordination.
 */
export interface SynapseAdjustmentPlan {
  /** Source neuron UUID */
  readonly fromUUID: string;
  /** Destination neuron UUID */
  readonly toUUID: string;
  /** Original weight before quantum adjustment */
  readonly originalWeight: number;
  /** Candidate weight from independent quantum adjustment */
  readonly candidateWeight: number;
}

/**
 * Describes a neuron's full adjustment plan including bias and all incoming synapses.
 */
export interface NeuronAdjustmentPlan {
  /** UUID of the neuron being adjusted */
  readonly neuronUUID: string;
  /** Original bias before quantum adjustment */
  readonly originalBias: number;
  /** Candidate bias from independent quantum adjustment */
  readonly candidateBias: number;
  /** Incoming synapses with their candidate adjustments */
  readonly synapses: readonly SynapseAdjustmentPlan[];
}

/**
 * Result of coordinated bias-weight adjustment for a single synapse.
 */
export interface CoordinatedWeightResult {
  /** Source neuron UUID */
  readonly fromUUID: string;
  /** Destination neuron UUID */
  readonly toUUID: string;
  /** Final coordinated weight value */
  readonly weight: number;
}

/**
 * Result of coordinated bias-weight adjustments for a neuron.
 */
export interface CoordinatedAdjustmentResult {
  /** Final coordinated bias value */
  readonly adjustedBias: number;
  /** Final coordinated weight values */
  readonly adjustedWeights: readonly CoordinatedWeightResult[];
  /** Whether any parameter was actually changed */
  readonly changed: boolean;
}

/**
 * Coordinates bias and weight adjustments for a single neuron to ensure
 * changes produce a meaningful net effect.
 *
 * When both bias and weights are independently adjusted, their effects
 * can cancel out (e.g., +Δb and -Δw produce no net change to the neuron's
 * output). This function detects such cases and redistributes the changes
 * to preserve the intended net effect.
 *
 * Strategy:
 * 1. If only bias or only weights changed, pass through unchanged.
 * 2. If both changed, calculate the total intended magnitude of change
 *    and ensure the bias and weight deltas are aligned (same sign contribution).
 * 3. When opposing changes are detected, scale back the smaller opposing
 *    change to preserve the net effect direction.
 *
 * @param plan - The neuron's adjustment plan with candidate values
 * @returns Coordinated adjustment result
 */
export function coordinateBiasWeightAdjustments(
  plan: NeuronAdjustmentPlan,
): CoordinatedAdjustmentResult {
  const biasDelta = plan.candidateBias - plan.originalBias;
  const biasChanged = biasDelta !== 0;

  // Compute weight deltas
  const weightDeltas: number[] = [];
  let anyWeightChanged = false;
  for (const synapse of plan.synapses) {
    const delta = synapse.candidateWeight - synapse.originalWeight;
    weightDeltas.push(delta);
    if (delta !== 0) {
      anyWeightChanged = true;
    }
  }

  // If nothing changed, return early
  if (!biasChanged && !anyWeightChanged) {
    return {
      adjustedBias: plan.originalBias,
      adjustedWeights: plan.synapses.map((s) => ({
        fromUUID: s.fromUUID,
        toUUID: s.toUUID,
        weight: s.originalWeight,
      })),
      changed: false,
    };
  }

  // If only bias or only weights changed, pass through without coordination
  if (!biasChanged || !anyWeightChanged) {
    return {
      adjustedBias: plan.candidateBias,
      adjustedWeights: plan.synapses.map((s) => ({
        fromUUID: s.fromUUID,
        toUUID: s.toUUID,
        weight: s.candidateWeight,
      })),
      changed: true,
    };
  }

  // Both bias and weights changed - coordinate to ensure net effect
  // Calculate the sum of weight deltas (net weight change direction)
  const netWeightDelta = weightDeltas.reduce((sum, d) => sum + d, 0);

  // Check if bias and net weight changes oppose each other
  // Opposing changes risk cancellation: Δb > 0 but netΔw < 0 (or vice versa)
  const biasSign = Math.sign(biasDelta);
  const weightSign = Math.sign(netWeightDelta);

  if (biasSign !== 0 && weightSign !== 0 && biasSign === -weightSign) {
    // Opposing changes detected - reduce the smaller opposing change
    // to preserve net effect direction
    const biasAbs = Math.abs(biasDelta);
    const weightAbs = Math.abs(netWeightDelta);

    if (biasAbs <= weightAbs) {
      // Bias is the smaller opposing force - scale it towards zero
      // Keep at least 20% of original bias delta to maintain some exploration
      const reductionFactor = 0.2;
      const adjustedBiasDelta = biasDelta * reductionFactor;

      return {
        adjustedBias: plan.originalBias + adjustedBiasDelta,
        adjustedWeights: plan.synapses.map((s) => ({
          fromUUID: s.fromUUID,
          toUUID: s.toUUID,
          weight: s.candidateWeight,
        })),
        changed: true,
      };
    } else {
      // Weight changes are the smaller opposing force - scale them down
      const reductionFactor = 0.2;
      const adjustedWeights = plan.synapses.map((s, i) => {
        const delta = weightDeltas[i];
        if (delta === 0) {
          return {
            fromUUID: s.fromUUID,
            toUUID: s.toUUID,
            weight: s.originalWeight,
          };
        }
        return {
          fromUUID: s.fromUUID,
          toUUID: s.toUUID,
          weight: s.originalWeight + delta * reductionFactor,
        };
      });

      return {
        adjustedBias: plan.candidateBias,
        adjustedWeights,
        changed: true,
      };
    }
  }

  // Bias and weights are aligned (same direction) or one is zero
  // Pass through both - aligned changes reinforce each other
  return {
    adjustedBias: plan.candidateBias,
    adjustedWeights: plan.synapses.map((s) => ({
      fromUUID: s.fromUUID,
      toUUID: s.toUUID,
      weight: s.candidateWeight,
    })),
    changed: true,
  };
}

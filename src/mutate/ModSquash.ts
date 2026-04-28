import { removeTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import { AbstractMutationOperator } from "@mutate/AbstractMutationOperator.ts";
import { Activations } from "@methods/activations/Activations.ts";
import type { SquashEffectivenessTracker } from "@neat/SquashEffectivenessTracker.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

/**
 * Mutation operator that swaps a neuron's squash (activation) function.
 *
 * Issue #2457: When a {@link SquashEffectivenessTracker} is supplied, the
 * operator consults the tracker for a fitness-biased squash candidate. If
 * the tracker is disabled, has insufficient samples, or rolls an
 * exploration draw, sampling falls back to the existing uniform pool in
 * {@link Activations.pickRandomSquash}.
 */
export class ModActivation extends AbstractMutationOperator {
  private readonly tracker?: SquashEffectivenessTracker;

  constructor(creature: Creature, tracker?: SquashEffectivenessTracker) {
    super(creature);
    this.tracker = tracker;
  }

  protected performMutation(focusList?: number[]): boolean {
    const index = this.selectRandomNonInputNeuronIndex(focusList);
    if (index === -1) return false;

    const neuron = this.creature.neurons[index];
    if (neuron.type !== "hidden" && neuron.type !== "output") {
      return false;
    }

    const previousSquash: string | undefined = neuron.squash;

    // Compute role and consult the tracker for a fitness-biased pick.
    let chosen: string | null = null;
    let role: ReturnType<SquashEffectivenessTracker["computeRole"]> | undefined;
    if (this.tracker?.isEnabled()) {
      role = this.tracker.computeRole(this.creature, index);
      const candidates = uniqueSquashCandidates(previousSquash);
      chosen = this.tracker.pickSquashBiased(
        role,
        candidates,
        getRandomNumberGenerator(),
      );
    }

    // pickRandomSquash signature historically expected a string; pass an
    // empty string when the neuron has no squash yet so the random pool is
    // returned unfiltered.
    const newSquash = chosen ??
      Activations.pickRandomSquash(previousSquash ?? "");
    if (!newSquash || newSquash === previousSquash) {
      // No usable change. Mirror the historic neuron.mutate() behaviour and
      // report no mutation.
      return false;
    }

    neuron.setSquash(newSquash);
    removeTag(neuron, "CRISPR");

    // Mirror the post-mutation invariants set in NeuronTopology.mutate().
    delete this.creature.uuid;
    this.creature.state.preparedNeurons = false;

    // Record the pending mutation so the next fitness pass can update the
    // tracker with the observed delta. We capture the pre-mutation score
    // (when present) to compute a true delta; for newly bred creatures
    // that lack a baseline, the tracker uses the absolute fitness as an
    // approximate signal.
    if (this.tracker?.isEnabled() && role) {
      this.tracker.recordPending(
        this.creature,
        role,
        newSquash,
        this.creature.score,
      );
    }

    neuron.fix();
    delete this.creature.memetic;
    return true;
  }
}

/**
 * Build the candidate squash list for biased sampling. Aliases
 * (e.g. RELU → ReLU) and the current squash are excluded so the draw
 * always proposes a real change.
 */
function uniqueSquashCandidates(exclude: string | undefined): string[] {
  const result: string[] = [];
  for (const activation of Activations.list()) {
    const name = activation.getName();
    if (name === exclude) continue;
    result.push(name);
  }
  return result;
}

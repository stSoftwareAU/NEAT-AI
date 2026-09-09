import { removeTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import { AbstractMutationOperator } from "@mutate/AbstractMutationOperator.ts";
import { Activations } from "@methods/activations/Activations.ts";
import { isGradientBlockingSquash } from "@methods/activations/GradientBlocking.ts";
import {
  type DeepChainSquashOptions,
  type ResolvedDeepChainSquashOptions,
  resolveDeepChainSquashOptions,
} from "@mutate/DeepChainSquashOptions.ts";
import { hiddenRunLengthAt } from "@propagate/SerialChains.ts";
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
 *
 * Issue #3974: both of those pools are depth-blind. When
 * `deepChainSquashBias` is positive and the neuron being re-squashed sits
 * inside a serial run of at least `deepChainMinLength` members, a proposal of
 * a gradient-blocking activation is re-drawn once with that probability. It is
 * a bias, not a ban — a second blocking proposal stands, so nothing leaves the
 * search space — and at the default bias of `0` no extra randomness is drawn
 * and no extra topology scan runs, leaving behaviour bit-identical.
 */
export class ModActivation extends AbstractMutationOperator {
  private readonly tracker?: SquashEffectivenessTracker;
  private readonly deepChain: ResolvedDeepChainSquashOptions;

  constructor(
    creature: Creature,
    tracker?: SquashEffectivenessTracker,
    deepChainOptions?: DeepChainSquashOptions,
  ) {
    super(creature);
    this.tracker = tracker;
    this.deepChain = resolveDeepChainSquashOptions(deepChainOptions);
  }

  protected performMutation(focusList?: number[]): boolean {
    const index = this.selectRandomNonInputNeuronIndex(focusList);
    if (index === -1) return false;

    const neuron = this.creature.neurons[index];
    if (neuron.type !== "hidden" && neuron.type !== "output") {
      return false;
    }

    // Issue #3797: an output-squash pin makes output neurons ineligible, so
    // no tracker sample or creature-state invalidation is spent on them.
    if (
      neuron.type === "output" && Activations.getFixedOutputSquash() !== null
    ) {
      return false;
    }

    const previousSquash: string | undefined = neuron.squash;

    // Compute role and consult the tracker for a fitness-biased pick.
    let role: ReturnType<SquashEffectivenessTracker["computeRole"]> | undefined;
    if (this.tracker?.isEnabled()) {
      role = this.tracker.computeRole(this.creature, index);
    }

    const draw = () => this.drawSquash(previousSquash, role);
    let newSquash = draw();

    // Issue #3974: down-weight a gradient-blocking proposal for a neuron
    // inside a long serial run. The order of the guards is the cost order —
    // the topology scan runs only for a blocking proposal under a live bias.
    if (
      this.deepChain.deepChainSquashBias > 0 &&
      newSquash &&
      isGradientBlockingSquash(newSquash) &&
      this.insideDeepChain(index) &&
      getRandomNumberGenerator().random() < this.deepChain.deepChainSquashBias
    ) {
      newSquash = draw();
    }

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
    // Issue #3971: the re-squashed neuron is the mutation site.
    this.noteMutationSite(neuron.index);
    return true;
  }

  /**
   * One squash proposal: the tracker's fitness-biased pick when it offers
   * one, otherwise the uniform pool.
   *
   * `pickRandomSquash` historically expected a string, so a neuron with no
   * squash yet passes an empty string and the pool is returned unfiltered.
   */
  private drawSquash(
    previousSquash: string | undefined,
    role: ReturnType<SquashEffectivenessTracker["computeRole"]> | undefined,
  ): string {
    if (this.tracker?.isEnabled() && role) {
      const chosen = this.tracker.pickSquashBiased(
        role,
        uniqueSquashCandidates(previousSquash),
        getRandomNumberGenerator(),
      );
      if (chosen) return chosen;
    }
    return Activations.pickRandomSquash(previousSquash ?? "");
  }

  /**
   * Whether the neuron sits inside a serial run long enough for the bias to
   * apply — the run length #3973's bypass operator also measures.
   */
  private insideDeepChain(index: number): boolean {
    return hiddenRunLengthAt(this.creature, index) >=
      this.deepChain.deepChainMinLength;
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

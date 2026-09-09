/**
 * @module
 *
 * Mutation operator that proposes a **bypass synapse** around a deep serial run
 * of neurons — the residual construction `x + F(x)`, with the existing run
 * playing `F` (Issue #3973).
 *
 * The topology already permits this: any forward synapse from a low-index
 * neuron to a high-index one *is* a skip connection, so nothing in the
 * representation changes. What was missing is an operator that proposes one
 * **deliberately**. `AddConnection` draws its endpoints uniformly, so on a
 * creature with thousands of neurons the chance a single draw straddles one
 * specific deep chain is negligible — which is exactly what #3972 measured on
 * `test/data/grq-23-forests-constants.json`: the output neuron has fan-in 325
 * and a one-hop path from the inputs, while the 28-neuron single-file tail from
 * depth 34 to 61 has no bypass anywhere along it.
 *
 * Selection is the whole operator; a randomly placed skip is just
 * `AddConnection`:
 *
 * 1. Serial runs come from {@link findSerialChains} (#3972) — maximal runs of
 *    consecutive depth levels holding exactly one neuron each, connected end to
 *    end. That is the structure with no depth-parallel route around it, so a
 *    single zero derivative anywhere along it zeroes the gradient for every
 *    member upstream.
 * 2. Runs shorter than `skipMinRunLength` are ignored.
 * 3. Longer runs are preferred, ties broken by the deeper run — the one the
 *    gradient has to survive the most hops to reach. #3972's zero-gradient
 *    fraction is deliberately **not** consulted here: measuring it needs input
 *    samples the operator is never given, and costs a full forward and reverse
 *    sweep per sample, which cannot ride on every mutation. The bench harness
 *    `bench/skip_connection_null_comparison.ts` measures it instead.
 * 4. The bypass runs from the run's entry neuron to a neuron the run feeds, so
 *    that consumer sees both the processed signal and a short-path copy of the
 *    entry activation.
 * 5. The new synapse is initialised at `structuralWeightScale` (#3970), not at
 *    a full `[-0.5, +0.5]` draw. A ±0.5 bypass around a tuned run is the same
 *    mistake #3970 describes.
 *
 * Exactly one bypass is added per `mutate()` call, so stacking bypasses around
 * the same run in one generation cannot make the result unattributable in
 * #3971's per-operator telemetry.
 */
import { rejectRecurrentSynapseIfForwardOnlyCreature } from "@architecture/ForwardOnlySynapseGuard.ts";
import { Synapse } from "@architecture/Synapse.ts";
import type { Creature } from "@creature";
import { AbstractMutationOperator } from "@mutate/AbstractMutationOperator.ts";
import {
  type ResolvedSkipConnectionOptions,
  resolveSkipConnectionOptions,
  type SkipConnectionOptions,
} from "@mutate/SkipConnectionOptions.ts";
import { findSerialChains, type SerialChain } from "@propagate/SerialChains.ts";
import { clampAndTrack } from "@utils/OverflowGuardStats.ts";

/** One proposed bypass. */
export interface SkipCandidate {
  /** Neuron index the bypass starts from — the run's entry. */
  entry: number;
  /** Neuron index the bypass lands on — a neuron the run feeds. */
  target: number;
  /** Hidden members of the run being bypassed, entry included. */
  runLength: number;
  /** Depth of the run's last hidden member. */
  runEndDepth: number;
}

/**
 * The hidden members of a chain, shallowest first, stopping at the first
 * non-hidden member.
 *
 * {@link findSerialChains} includes the output neuron when a chain ends there,
 * but an output is not part of the *run* — it is the neuron the run feeds.
 */
function hiddenRun(creature: Creature, chain: SerialChain): number[] {
  const run: number[] = [];
  for (const member of chain.members) {
    if (creature.neurons[member.index].type !== "hidden") break;
    run.push(member.index);
  }
  return run;
}

export class AddSkipConnection extends AbstractMutationOperator {
  private readonly options: ResolvedSkipConnectionOptions;

  constructor(creature: Creature, options?: SkipConnectionOptions) {
    super(creature);
    this.options = resolveSkipConnectionOptions(options);
  }

  /**
   * Every bypass this operator would consider, in preference order: longest
   * run first, then the deeper run, then by endpoint index so the order is
   * total and the operator is reproducible.
   *
   * Exposed so the bench harness and the tests can inspect the targeting
   * without mutating the creature.
   *
   * @param focusList - Optional list of neuron indices to focus on. Candidates
   *   with both endpoints in focus are preferred; when none qualify the focus
   *   constraint is relaxed rather than losing the mutation entirely.
   * @returns The candidates, best first; empty when the topology offers none.
   */
  public candidates(focusList?: number[]): SkipCandidate[] {
    const creature = this.creature;
    const minRunLength = this.options.skipMinRunLength;
    const found: SkipCandidate[] = [];

    for (const chain of findSerialChains(creature)) {
      const run = hiddenRun(creature, chain);
      if (run.length < minRunLength) continue;

      const entry = run[0];
      const exit = run[run.length - 1];
      const members = new Set(run);

      for (const synapse of creature.outwardConnections(exit)) {
        const target = synapse.to;
        // The run's exit may also carry a **back**-edge when the lineage is
        // recurrent, and a back-edge's destination is not a neuron the run
        // feeds — it is a neuron that feeds the run on the next step. Following
        // one would land the "bypass" inside the run (`entry -> run[3]`), a
        // partial short-circuit rather than the bypass around it.
        if (synapse.to <= synapse.from) continue;
        // Nor may the bypass land on the run itself: every member is already
        // reachable from the entry through the run.
        if (members.has(target)) continue;
        // Forward, and it must skip something: a target at or before the entry
        // would be a back-edge from the bypass's own point of view.
        if (target <= entry) continue;
        if (creature.neurons[target].type === "constant") continue;
        if (creature.hasConnection(entry, target)) continue;

        found.push({
          entry,
          target,
          runLength: run.length,
          runEndDepth: chain.members[run.length - 1].depth,
        });
      }
    }

    found.sort((a, b) =>
      b.runLength - a.runLength ||
      b.runEndDepth - a.runEndDepth ||
      a.entry - b.entry ||
      a.target - b.target
    );

    if (!focusList || focusList.length === 0) return found;

    const focused = found.filter((candidate) =>
      creature.inFocus(candidate.entry, focusList) &&
      creature.inFocus(candidate.target, focusList)
    );
    return focused.length > 0 ? focused : found;
  }

  protected performMutation(focusList?: number[]): boolean {
    const creature = this.creature;
    const candidate = this.candidates(focusList)[0];
    if (candidate === undefined) return false;

    // The guard already runs inside `connect()`; calling it here means a
    // forward-only violation is refused by this operator rather than being
    // discovered several frames deeper.
    rejectRecurrentSynapseIfForwardOnlyCreature(
      creature,
      candidate.entry,
      candidate.target,
    );

    const weight = clampAndTrack(
      Synapse.randomWeight(this.options.structuralWeightScale),
      "mutation.synapse",
      "AddSkipConnection",
    );
    creature.connect(candidate.entry, candidate.target, weight);
    delete creature.memetic;
    // Issue #3971: the target of the new synapse is the mutation site.
    this.noteMutationSite(candidate.target);
    return true;
  }
}

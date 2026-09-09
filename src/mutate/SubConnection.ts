/**
 * @module
 *
 * Mutation operator that removes a feed-forward connection from the network.
 *
 * The removal itself is NEAT-AI-core's (Issue #3976): this operator chooses a
 * candidate and hands the creature to the shared `prune_synapse` rewrite, which
 * cuts exactly the named `(from, to, role)` triple, folds what the creature
 * itself fixes into the target's bias, rewrites whatever `IF` structure the
 * removal made statically decidable, cascades away what is left stranded,
 * canonicalises and validates before answering.
 *
 * ```mermaid
 * flowchart LR
 *   C["choose a forward,<br/>in-focus synapse"] --> K["(fromUUID, toUUID, type)"]
 *   K --> P["corePruneSynapse"]
 *   P -- "refusal" --> F["false — no change"]
 *   P -- "rewrite" --> L["loadFrom(the rewritten export)"]
 *   L --> T["true"]
 * ```
 *
 * There is no TypeScript rewrite behind this and no fallback to one
 * ([principle 7](../../docs/ENGINEERING_PRINCIPLES.md)). The superseded
 * in-place edit — demote the stranded target to a constant, cascade the
 * orphaned source, drop the memetic record wholesale, and decline outright any
 * removal that would leave an `IF` short a role — is deleted. Core's answers
 * are strictly better on the last of those: an `IF` short a role is rewritten
 * exactly rather than left unreachable to mutation.
 */
import type { Synapse } from "@architecture/Synapse.ts";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";
import type { Creature } from "@creature";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { AbstractMutationOperator } from "@mutate/AbstractMutationOperator.ts";
import { corePruneSynapse } from "@wasm/WasmPruneSynapse.ts";

/**
 * The wire endpoint label a synapse of this creature is exported under.
 *
 * Inputs are not listed in the export, so they are named by array position
 * exactly as `CreatureExportBuilder` names them; everything else answers to
 * `neuronUuid`, which throws rather than inventing a label for a hidden neuron
 * that has lost its uuid.
 */
function endpointUuid(creature: Creature, index: number): string {
  const neuron = creature.neurons[index];
  return neuron.type === "input" ? `input-${index}` : neuronUuid(neuron);
}

export class SubConnection extends AbstractMutationOperator {
  /**
   * Subtract a connection from the network.
   *
   * Candidate selection stays here — it is the operator's own policy — and the
   * rewrite belongs to core.
   */
  protected performMutation(focusList?: number[]): boolean {
    const creature = this.creature;
    const rng = getRandomNumberGenerator();

    const possible: Synapse[] = [];

    for (const conn of creature.synapses) {
      // Self and back connections belong to SubSelfCon / SubBackCon.
      if (conn.to <= conn.from) continue;

      if (
        creature.inFocus(conn.to, focusList) ||
        creature.inFocus(conn.from, focusList)
      ) {
        possible.push(conn);
      }
    }

    if (possible.length === 0) {
      return false;
    }

    const chosen = possible[Math.floor(rng.random() * possible.length)];

    // Issue #3873: the identity of a synapse is the `(from, to, type)` triple,
    // not the ordered pair — an `IF` target may be fed once per branch by one
    // source, so naming the pair alone would remove a branch nobody chose.
    const outcome = corePruneSynapse(creature.exportJSON(), {
      fromUUID: endpointUuid(creature, chosen.from),
      toUUID: endpointUuid(creature, chosen.to),
      type: chosen.type,
    });

    if (!outcome.ok) {
      // Core understood the request and declined it, so the creature is
      // unchanged — reported rather than swallowed, and never retried against
      // a superseded rewrite.
      getLogger().warn(
        `[SubConnection] core refused to remove the synapse: ` +
          `${outcome.reason} — ${outcome.message}`,
      );
      return false;
    }

    // The answer is already canonical and core-validated. `loadFrom` sheds the
    // content-derived creature uuid the edit invalidated, and carries the
    // memetic record core pruned entry by entry — the superseded operator threw
    // the whole record away.
    creature.loadFrom(outcome.creature, false, "SubConnection");

    return true;
  }
}

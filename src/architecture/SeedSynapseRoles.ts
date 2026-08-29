/**
 * Issue #3851: role wiring for structurally-constrained seed neurons.
 *
 * `IF` is the only squash whose validity depends on the neuron's inward
 * topology: `CreatureValidate` requires at least three inward synapses
 * carrying all three roles — `condition` (what the branch tests),
 * `positive` and `negative` (the two branch values). A seed that emits `IF`
 * neurons with untyped inward synapses is invalid at birth, and only becomes
 * usable because some downstream `fix()` invents the wiring. That is
 * structural design work no producer ever chose, so two runs of the same
 * factory can be rescued differently.
 *
 * This module is the producer-side answer: the factory emits a **valid**
 * `IF` neuron or refuses to build the seed at all.
 *
 * The assignment is a deterministic round-robin over the neuron's inward
 * synapses ordered by source index — `condition`, `positive`, `negative`,
 * repeating. Every role therefore reads at least one real source, every
 * source stays in play, and the same spec always yields the same seed.
 *
 * @module
 */

import type { Creature } from "@creature";
import { TopologyError } from "@errors/TopologyError.ts";
import { STRUCTURALLY_CONSTRAINED_SQUASHES } from "@intelligentDesign/SquashSubstitutionEligibility.ts";

import { shedIdentity } from "@architecture/ScoreProvenance.ts";
/**
 * The three roles, in the order a seed assigns them. `CreatureValidate`
 * requires one inward synapse of each.
 */
const SEED_ROLE_CYCLE = ["condition", "positive", "negative"] as const;

/** Minimum inward connections a structurally-constrained neuron needs. */
export const MINIMUM_ROLE_INWARD_CONNECTIONS = SEED_ROLE_CYCLE.length;

/** The spec field that chose this neuron's squash, for the failure message. */
function ruleFor(neuronType: string): string {
  return neuronType === "output" ? "outputLayer.squash" : "hiddenSquash";
}

/**
 * Give every structurally-constrained neuron in a freshly built seed its
 * required synapse roles.
 *
 * @param creature - The seed creature, straight from the constructor.
 * @param producer - Producer name used to prefix a failure, e.g.
 *   `"creatureForProblem"`.
 * @throws TopologyError when a neuron carries a structurally-constrained
 *   squash the seed topology cannot satisfy (fewer than three inward
 *   connections). Failing at seed time is deliberate: emitting the neuron
 *   anyway would hand the design decision to a downstream repair pass that
 *   may not even be there.
 */
export function assignSeedSynapseRoles(
  creature: Creature,
  producer: string,
): void {
  let assigned = false;

  for (let index = creature.input; index < creature.neurons.length; index++) {
    const neuron = creature.neurons[index];
    const squash = neuron.squash;
    if (!squash || !STRUCTURALLY_CONSTRAINED_SQUASHES.has(squash)) continue;

    const inward = creature.inwardConnections(index).slice()
      .sort((a, b) => a.from - b.from);

    if (inward.length < MINIMUM_ROLE_INWARD_CONNECTIONS) {
      throw new TopologyError(
        `${producer}: ${ruleFor(neuron.type)} '${squash}' cannot be seeded — ` +
          `a '${squash}' neuron needs at least ${MINIMUM_ROLE_INWARD_CONNECTIONS} ` +
          `inward connections (${SEED_ROLE_CYCLE.join(", ")}) and neuron ` +
          `${index} was seeded with ${inward.length}. Seed at least ` +
          `${MINIMUM_ROLE_INWARD_CONNECTIONS} sources per '${squash}' neuron ` +
          `or drop '${squash}' from the rule set.`,
        "INVALID_SQUASH",
      );
    }

    for (let i = 0; i < inward.length; i++) {
      inward[i].type = SEED_ROLE_CYCLE[i % SEED_ROLE_CYCLE.length];
      assigned = true;
    }
  }

  if (assigned) {
    // Synapse roles feed the content-derived identity (Issue #3843), so a
    // uuid minted before the roles existed no longer describes the creature.
    shedIdentity(creature);
    creature.clearCache();
  }
}

/**
 * Issue #4096 — Benchmark: one `SUB_CONN` mutation at production scale.
 *
 * `SubConnection` (the `SUB_CONN` mutation) picks a random forward synapse and
 * hands the whole creature to NEAT-AI-core's `prune_synapse` through
 * `corePruneSynapse`, which runs a cleanup pass including
 * `splice_identity_neurons`. That step costs O(identity neurons × synapses), so
 * one mutation is quadratic in creature size and runs synchronously on the main
 * thread. This bench drives the real operator through
 * `Mutator.mutateCreature` on a seeded creature at two sizes, so its cost is
 * the `corePruneSynapse` call:
 *
 * - 4,107 neurons / ~27k synapses
 * - 6,157 neurons / ~39k synapses
 *
 * The cost lives in NEAT-AI-core, not here; see "Field observation
 * (2026-11-21) and root cause" in `docs/TIMEOUTS.md`. Each case runs once
 * (`n: 1`) because each takes seconds. The first `SUB_CONN` on a freshly built
 * creature also splices its spliceable `IDENTITY` neurons and costs several
 * times more, so registration runs that call once, outside the bench, and the
 * reported time is the second call on the settled creature.
 *
 * Run with:
 *   deno bench -A bench/PruneSynapseProductionScale.ts
 */

import { Creature } from "@creature";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutation } from "@neat/Mutation.ts";
import { buildNetwork, seededRandom } from "./_productionScaleCreature.ts";

const INPUT_COUNT = 2054;
const OUTPUT_COUNT = 3;
const MAX_FAN_OUT = 7;

function build(layers: readonly number[]): Creature {
  const creature = Creature.fromJSON(
    buildNetwork(
      seededRandom(7),
      INPUT_COUNT,
      OUTPUT_COUNT,
      layers,
      MAX_FAN_OUT,
    ),
  );
  creature.fix({ forwardOnly: true });
  return creature;
}

function register(name: string, layers: readonly number[]): void {
  const creature = build(layers);
  const mutator = new Mutator(createNeatConfig({ mutation: Mutation.FFW }));
  // Settle the creature: the first call also splices its IDENTITY neurons.
  mutator.mutateCreature(creature, { name: "SUB_CONN" });

  Deno.bench({
    name,
    group: "SUB_CONN",
    n: 1,
    warmup: 0,
    fn: () => {
      mutator.mutateCreature(creature, { name: "SUB_CONN" });
    },
  });
}

register("4,107 neurons", [400, 400, 400, 400, 450]);
register("6,157 neurons", [800, 800, 800, 800, 900]);

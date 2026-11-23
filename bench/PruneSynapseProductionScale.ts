/**
 * Issue #4096 — Benchmark: one `corePruneSynapse` call at production scale.
 *
 * `SubConnection` (the `SUB_CONN` mutation) hands the whole creature to
 * NEAT-AI-core's `prune_synapse`, which runs a cleanup pass including
 * `splice_identity_neurons`. That step costs O(identity neurons × synapses), so
 * one call is quadratic in creature size and runs synchronously on the main
 * thread. This bench times exactly that call, on the middle forward synapse of
 * a seeded creature, at two sizes:
 *
 * - 4,107 neurons / ~27k synapses
 * - 6,157 neurons / ~39k synapses
 *
 * The cost lives in NEAT-AI-core, not here; see "Field observation
 * (2026-11-21) and root cause" in `docs/TIMEOUTS.md`. Each case runs once
 * (`n: 1`) because each takes tens of seconds.
 *
 * Run with:
 *   deno bench -A bench/PruneSynapseProductionScale.ts
 */

import { Creature } from "@creature";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";
import { corePruneSynapse } from "@wasm/WasmPruneSynapse.ts";
import { buildNetwork, seededRandom } from "./_productionScaleCreature.ts";

const INPUT_COUNT = 2054;
const OUTPUT_COUNT = 3;
const MAX_FAN_OUT = 7;

/** Same endpoint label `SubConnection` sends to core. */
function endpointUuid(creature: Creature, index: number): string {
  const neuron = creature.neurons[index];
  return neuron.type === "input" ? `input-${index}` : neuronUuid(neuron);
}

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
  const forward = creature.synapses.filter((s) => s.to > s.from);
  const chosen = forward[Math.floor(forward.length / 2)];
  const request = {
    fromUUID: endpointUuid(creature, chosen.from),
    toUUID: endpointUuid(creature, chosen.to),
    type: chosen.type,
  };

  Deno.bench({
    name,
    group: "corePruneSynapse",
    n: 1,
    warmup: 0,
    fn: () => {
      corePruneSynapse(creature.exportJSON(), request);
    },
  });
}

register("4,107 neurons", [400, 400, 400, 400, 450]);
register("6,157 neurons", [800, 800, 800, 800, 900]);

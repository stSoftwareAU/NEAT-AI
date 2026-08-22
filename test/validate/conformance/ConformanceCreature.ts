/**
 * @module
 *
 * Builds the in-memory {@link Creature} a conformance case describes
 * (Issue #3801).
 *
 * The corpus deliberately describes creatures in the **runtime**
 * (`CreatureInternal`) shape rather than the `exportJSON()` wire shape: most of
 * the states `creatureValidate` rejects — a duplicate id, a constant after a
 * hidden, an input neuron whose id is not its index — are exactly the states
 * the loader normalises or refuses, so a wire-shaped fixture could never reach
 * those throw sites. Fields are assigned after construction for the same
 * reason: `new Neuron(...)` rejects a non-finite bias and a constant carrying a
 * squash, both of which the corpus must be able to express.
 */

import { Creature } from "@creature";
import { Neuron } from "@architecture/Neuron.ts";
import { Synapse } from "@architecture/Synapse.ts";
import type { MemeticInterface } from "@blackbox/MemeticInterface.ts";
import type {
  CorpusCreature,
  CorpusNeuron,
  CorpusNumber,
} from "./ConformanceCase.ts";

/** Maps a corpus number onto its in-memory value; `null`/absent → `undefined`. */
function toRuntimeNumber(value: CorpusNumber | undefined): number | undefined {
  switch (value) {
    case undefined:
    case null:
      return undefined;
    case "Infinity":
      return Infinity;
    case "-Infinity":
      return -Infinity;
    case "NaN":
      return NaN;
    default:
      return value;
  }
}

function buildNeuron(
  spec: CorpusNeuron,
  arrayIndex: number,
  creature: Creature,
): Neuron {
  // Built as an input neuron because that branch of the constructor validates
  // nothing; every field is then set from the fixture.
  const neuron = new Neuron(0, "input", 0, creature);
  neuron.id = toRuntimeNumber(spec.id) as number;
  neuron.type = spec.type as Neuron["type"];
  const bias = toRuntimeNumber(spec.bias);
  // Input neurons carry Infinity at runtime; validation ignores their bias.
  neuron.bias = (bias === undefined && spec.type === "input")
    ? Infinity
    : bias as number;
  neuron.squash = spec.squash;
  neuron.uuid = spec.uuid;
  neuron.index = spec.index ?? arrayIndex;
  return neuron;
}

/**
 * Materialises a corpus creature. The result is only ever handed to
 * `creatureValidate` — it is not activated, trained or exported.
 */
export function buildConformanceCreature(spec: CorpusCreature): Creature {
  const creature = new Creature(spec.input, spec.output, {
    lazyInitialization: true,
    feedbackEnabled: true,
  });
  // Diagnostics writing is a side effect of DEBUG, not part of the contract.
  creature.DEBUG = false;
  creature.forwardOnly = spec.forwardOnly === true;
  creature.neurons = spec.neurons.map((n, indx) =>
    buildNeuron(n, indx, creature)
  );
  creature.synapses = spec.synapses.map((s) =>
    new Synapse(s.from, s.to, s.weight, s.type)
  );
  if (spec.memetic !== undefined) {
    creature.memetic = spec.memetic as MemeticInterface;
  }
  creature.clearCache();
  return creature;
}

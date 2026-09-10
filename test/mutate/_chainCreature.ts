/**
 * Shared fixture for the Issue #3973 skip-connection tests: a creature whose
 * tail is a single-file run of hidden neurons, which is the topology
 * `AddSkipConnection` exists to bypass.
 *
 * Defined once because every test that needs a single-file run needs the same
 * shape: `test/mutate/AddSkipConnection.ts` (the operator) and
 * `test/NEAT/SkipConnectionRate.ts` (its selection through the `Mutator`), plus
 * `test/mutate/DeepChainSquashBias.ts` and
 * `test/NEAT/DeepChainSquashBiasConfig.ts` for #3974's depth-aware squash bias.
 */
import { assert } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/** Knobs for {@link chainCreature}. */
export interface ChainCreatureOptions {
  /** Mark the creature forward-only, so the recurrent guard applies. */
  forwardOnly?: boolean;
  /**
   * Extra depth-1 neurons hanging off the inputs and feeding the output, so the
   * run is not the only structure a uniformly drawn connection could land on.
   */
  extraWidth?: number;
  /** Squash for every neuron. Default `IDENTITY`. */
  squash?: string;
}

/**
 * A creature of `input-0`, `input-1` → `run-0` → … → `run-{n-1}` → `output-0`.
 *
 * A second input joins `run-0` so depth 1 still holds exactly one neuron,
 * matching the shape #3972 found in the GRQ creature.
 *
 * @param runLength - Hidden neurons in the single-file run.
 * @param options - See {@link ChainCreatureOptions}.
 * @returns The creature.
 */
export function chainCreature(
  runLength: number,
  options: ChainCreatureOptions = {},
): Creature {
  const squash = options.squash ?? "IDENTITY";
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (let i = 0; i < runLength; i++) {
    neurons.push({ type: "hidden", uuid: `run-${i}`, squash, bias: 0.1 });
    if (i === 0) {
      synapses.push({ fromUUID: "input-0", toUUID: "run-0", weight: 0.5 });
      synapses.push({ fromUUID: "input-1", toUUID: "run-0", weight: 0.25 });
    } else {
      synapses.push({
        fromUUID: `run-${i - 1}`,
        toUUID: `run-${i}`,
        weight: 0.5,
      });
    }
  }

  const width = options.extraWidth ?? 0;
  for (let i = 0; i < width; i++) {
    neurons.push({ type: "hidden", uuid: `wide-${i}`, squash, bias: 0 });
    synapses.push({ fromUUID: "input-0", toUUID: `wide-${i}`, weight: 0.1 });
    synapses.push({ fromUUID: `wide-${i}`, toUUID: "output-0", weight: 0.1 });
  }

  neurons.push({ type: "output", uuid: "output-0", squash, bias: 0 });
  synapses.push({
    fromUUID: `run-${runLength - 1}`,
    toUUID: "output-0",
    weight: 0.5,
  });

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons,
    synapses,
  });
  if (options.forwardOnly) creature.forwardOnly = true;
  return creature;
}

/**
 * Index of the neuron carrying `uuid`.
 *
 * @throws {Error} When the creature has no such neuron — a test that silently
 *   compared `undefined` would pass for the wrong reason.
 */
export function neuronIndex(creature: Creature, uuid: string): number {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  assert(neuron !== undefined, `creature should carry a neuron ${uuid}`);
  return neuron.index;
}

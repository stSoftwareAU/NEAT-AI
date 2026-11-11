/**
 * A deterministic, forward-only creature of a chosen size (Issue #4146).
 *
 * `bench/TrainingFinalisationLargeCreature.ts` times training finalisation on a
 * creature the size of the one in the issue (9,684 neurons, 63,317 synapses).
 * The builder lives here, parameterised, so that
 * `test/fixtures/LargeCreatureFixture.test.ts` can pin its shape on a small
 * instance rather than leaving the bench's fixture unchecked.
 *
 * @module
 */
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

export interface LargeCreatureShape {
  readonly inputs: number;
  readonly outputs: number;
  readonly hidden: number;
  /** Exact synapse count (it must be at least the structural minimum). */
  readonly synapses: number;
  /** Seed for the LCG, so the same creature is rebuilt on every run. */
  readonly seed: number;
}

/**
 * The size of the creature reported in Issue #4146: 9,684 neurons and 63,317
 * synapses. The issue gives only those two totals; the split is 50 inputs,
 * 5 outputs and so 9,629 hidden neurons.
 */
export const ISSUE_4146_SHAPE: LargeCreatureShape = {
  inputs: 50,
  outputs: 5,
  hidden: 9629,
  synapses: 63317,
  seed: 12345,
};

/**
 * Build the creature JSON: each hidden neuron is fed by an earlier neuron (the
 * first five by inputs), a fix-up gives every hidden neuron an outward
 * connection, and random extra synapses then fill up to exactly `synapses`.
 */
export function buildLargeCreatureJSON(
  shape: LargeCreatureShape,
): CreatureExport {
  const { inputs, outputs, hidden, synapses: target } = shape;
  let seed = shape.seed;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const neurons: CreatureExport["neurons"] = [];
  for (let i = 0; i < hidden; i++) {
    neurons.push({
      type: "hidden",
      uuid: `h-${i}`,
      bias: rnd() - 0.5,
      squash: "TANH",
    });
  }
  for (let o = 0; o < outputs; o++) {
    neurons.push({
      type: "output",
      uuid: `output-${o}`,
      bias: rnd() - 0.5,
      squash: "TANH",
    });
  }

  const synapses: CreatureExport["synapses"] = [];
  const seen = new Set<string>();
  const add = (fromUUID: string, toUUID: string) => {
    const key = `${fromUUID}>${toUUID}`;
    if (seen.has(key)) return;
    seen.add(key);
    synapses.push({ weight: (rnd() * 2 - 1) * 0.3, fromUUID, toUUID });
  };

  // The first five hidden neurons read the inputs; the rest read an earlier
  // hidden neuron.
  for (let i = 0; i < hidden; i++) {
    add(
      i < 5 ? `input-${i % inputs}` : `h-${Math.floor(rnd() * i)}`,
      `h-${i}`,
    );
  }
  for (let o = 0; o < outputs; o++) {
    add(`h-${hidden - 1 - o}`, `output-${o}`);
  }
  // Fix-up before the fill, so the total lands exactly on `target`: every
  // hidden neuron needs an outward connection.
  const hasOutward = new Set(synapses.map((s) => s.fromUUID));
  for (let i = 0; i < hidden; i++) {
    if (!hasOutward.has(`h-${i}`)) add(`h-${i}`, `output-${i % outputs}`);
  }

  while (synapses.length < target) {
    const to = Math.floor(rnd() * hidden);
    const from = rnd() < 0.3
      ? `input-${Math.floor(rnd() * inputs)}`
      : `h-${Math.floor(rnd() * (to || 1))}`;
    if (from === `h-${to}`) continue;
    add(from, `h-${to}`);
  }

  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    neurons,
    synapses,
    input: inputs,
    output: outputs,
  };
}

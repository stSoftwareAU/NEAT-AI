import { assertAlmostEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

Deno.test("backprop: LeakyReLU safe zone can divert elastic error away from far-negative raw inputs", () => {
  // Topology:
  //
  // input-0 --(w=100)--> hidden-0(LeakyReLU) --(w=0.1)--> output-0(IDENTITY)
  // input-1 ------------------------(w=1.0)------------------------^
  //
  // We choose input-0=-1 so hidden-0 rawInput≈-100 (far negative).
  // Then we request a more negative output, so the per-link error is negative.
  // LeakyReLU.safeZoneAdjustment() should block pushing rawInput further negative,
  // causing elastic backprop to allocate (almost) all error to the direct input-1 link.
  const creatureJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        uuid: "hidden-0",
        type: "hidden",
        squash: LeakyReLU.NAME,
        bias: 0,
      },
      {
        uuid: "output-0",
        type: "output",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 100 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1.0 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON, true);

  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    batchSize: 1, // apply immediately
    maximumWeightAdjustmentScale: 100,
    maximumBiasAdjustmentScale: 100,
    limitWeightScale: 1_000_000,
    limitBiasScale: 1_000_000,
    sparseRatio: 1,
    trainingMutationRate: 0, // keep deterministic (no random mutations)
  });

  const sparseConfig = new SparseConfig(creature.exportJSON(), config);

  // Forward pass with trace so we have correct hintValue (rawInput) for safeZoneAdjustment.
  const actual = creature.activateAndTrace(
    new Float32Array([-1, 1]),
    false,
    sparseConfig,
  );

  // Current output should be ≈ 0.9 (=-0.1 + 1.0)
  assertAlmostEquals(actual[0], 0.9, 1e-7);

  // Ask for a much lower output so the error is negative (pushes raw inputs more negative).
  creature.propagate(new Float32Array([-9.1]), config, sparseConfig);
  creature.propagateUpdate(config, sparseConfig);

  // The direct input-1 -> output-0 weight should absorb most/all change.
  // Expected: targetFromValue = 1 + (-10) = -9, activation=1 => weight≈-9.
  const hidden0 = creature.neurons.find((n) => n.uuid === "hidden-0")!;
  const output0 = creature.neurons.find((n) => n.uuid === "output-0")!;
  const input1 = creature.neurons.find((n) => n.uuid === "input-1")!;

  const wHiddenToOut =
    creature.getSynapse(hidden0.index, output0.index)!.weight;
  const wInput1ToOut = creature.getSynapse(input1.index, output0.index)!.weight;

  assertAlmostEquals(wHiddenToOut, 0.1, 1e-9);
  assertAlmostEquals(wInput1ToOut, -9, 1e-6);
});

import { assertAlmostEquals, assertNotEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { ArcTan } from "../../src/methods/activations/types/ArcTan.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

Deno.test(
  "backprop: does not recurse into saturated bounded parents (ArcTan/TANH) when safe-zone blocks (prefers weight updates)",
  () => {
    // This reproduces the production failure mode:
    // - two upstream bounded squashes are already deep into saturation
    // - output asks for a large change
    // - naive recursion tries to force those parents to move, even though their
    //   safe-zone indicates they are effectively immovable.
    //
    // Desired behaviour: do not recurse (do not alter upstream biases), but still
    // allow weight updates on the current neuron to absorb the change.

    const creatureJSON: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          uuid: "sat-arctan",
          type: "hidden",
          squash: ArcTan.NAME,
          bias: 100, // deep saturation: atan(100) ~ +pi/2
        },
        {
          uuid: "sat-tanh",
          type: "hidden",
          squash: TANH.NAME,
          bias: 100, // deep saturation: tanh(100) ~ +1
        },
        {
          uuid: "output-0",
          type: "output",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        // Keep parents saturated largely via bias; input weight is tiny so rawInput remains huge.
        { fromUUID: "input-0", toUUID: "sat-arctan", weight: 1e-6 },
        { fromUUID: "input-0", toUUID: "sat-tanh", weight: 1e-6 },
        { fromUUID: "sat-arctan", toUUID: "output-0", weight: 1 },
        { fromUUID: "sat-tanh", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(creatureJSON, true);
    const config = createBackPropagationConfig({
      generations: 0,
      learningRate: 1,
      batchSize: 1,
      sparseRatio: 1,
      trainingMutationRate: 0,
      maximumWeightAdjustmentScale: 1000,
      maximumBiasAdjustmentScale: 1000,
      limitWeightScale: 1_000_000,
      limitBiasScale: 1_000_000,
    });
    const sparseConfig = new SparseConfig(creature.exportJSON(), config);

    // Trace so hintValue (rawInput) is available for safe-zone logic.
    const actual = creature.activateAndTrace(
      new Float32Array([0]),
      false,
      sparseConfig,
    );
    assertNotEquals(actual[0], 0, "sanity: output should be non-zero");

    const arcTan = creature.neurons.find((n) => n.uuid === "sat-arctan")!;
    const tanh = creature.neurons.find((n) => n.uuid === "sat-tanh")!;
    const arcTanBiasBefore = arcTan.bias;
    const tanhBiasBefore = tanh.bias;

    // Large target change to trigger recursion temptation.
    creature.propagate(
      new Float32Array([-(actual[0] + 10)]),
      config,
      sparseConfig,
    );
    creature.propagateUpdate(config, sparseConfig);

    // If recursion happened, these saturated parents would typically have their
    // bias adjusted. We expect them to remain unchanged.
    assertAlmostEquals(arcTan.bias, arcTanBiasBefore, 1e-12);
    assertAlmostEquals(tanh.bias, tanhBiasBefore, 1e-12);
  },
);

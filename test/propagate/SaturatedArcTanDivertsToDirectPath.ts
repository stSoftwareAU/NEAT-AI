import { assertAlmostEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { ArcTan } from "../../src/methods/activations/types/ArcTan.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

Deno.test(
  "backprop: saturated ArcTan parent diverts error to feasible direct path (no forced upstream activation)",
  () => {
    // Path-of-least-resistance regression:
    // If an ArcTan parent is deep in saturation, we should prefer updating the
    // direct inbound weight rather than trying to recurse into the ArcTan neuron.

    const creatureJSON: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          uuid: "sat-arctan",
          type: "hidden",
          squash: ArcTan.NAME,
          bias: 100,
        },
        {
          uuid: "output-0",
          type: "output",
          squash: IDENTITY.NAME,
          bias: 0,
        },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "sat-arctan", weight: 1 },
        { fromUUID: "sat-arctan", toUUID: "output-0", weight: 1 },
        { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
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

    // Trace to populate hintValue.
    const actual = creature.activateAndTrace(
      new Float32Array([1]),
      false,
      sparseConfig,
    );

    const arcTan = creature.neurons.find((n) => n.uuid === "sat-arctan")!;
    const arcTanBiasBefore = arcTan.bias;
    const output = creature.neurons.find((n) => n.uuid === "output-0")!;
    const input0 = creature.neurons.find((n) => n.uuid === "input-0")!;

    const wInputToOutBefore = creature.getSynapse(input0.index, output.index)!
      .weight;

    // Ask for a big negative shift.
    creature.propagate(
      new Float32Array([actual[0] - 10]),
      config,
      sparseConfig,
    );
    creature.propagateUpdate(config, sparseConfig);

    // ArcTan bias should not be forced to move while saturated.
    assertAlmostEquals(arcTan.bias, arcTanBiasBefore, 1e-12);

    // The direct input->output weight should take the update.
    const wInputToOutAfter = creature.getSynapse(input0.index, output.index)!
      .weight;
    assertAlmostEquals(wInputToOutAfter, wInputToOutBefore - 10, 1e-3);
  },
);

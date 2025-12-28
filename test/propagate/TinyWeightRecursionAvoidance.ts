import { assertAlmostEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "../../src/methods/activations/types/LOGISTIC.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

Deno.test(
  "backprop: avoids recursing activation targets through tiny weights (bounded squash parent)",
  () => {
    // Tiny weight -> modest value-space share implies huge requested activation:
    //   targetFromActivation = (w*a + share) / w
    // For bounded squashes, this is infeasible and should *not* trigger recursion.

    const creatureJSON: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        {
          uuid: "logistic-hidden",
          type: "hidden",
          squash: LOGISTIC.NAME,
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
        { fromUUID: "input-0", toUUID: "logistic-hidden", weight: 1 },

        // Critical: tiny weight into output. This is where recursion explodes.
        { fromUUID: "logistic-hidden", toUUID: "output-0", weight: 1e-6 },

        // Feasible alternative path:
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

    creature.activateAndTrace(new Float32Array([1]), false, sparseConfig);

    const hidden = creature.neurons.find((n) => n.uuid === "logistic-hidden")!;
    const biasBefore = hidden.bias;

    // Ask for a big negative output change.
    creature.propagate(new Float32Array([-100]), config, sparseConfig);
    creature.propagateUpdate(config, sparseConfig);

    // If recursion happened through the tiny weight, the hidden bias would
    // typically move as the solver tries to change activation.
    assertAlmostEquals(hidden.bias, biasBefore, 1e-12);
  },
);

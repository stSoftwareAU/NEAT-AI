import { assert } from "@std/assert";
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
    // For bounded squashes, the target is clamped to the range boundary
    // (Issue #1873) so a reduced gradient still propagates without explosion.

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

        // Critical: tiny weight into output. Previously dropped entirely;
        // now clamped so a reduced gradient propagates.
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

    const hidden = creature.neurons.find((n) => n.id === 9213)!;

    // Ask for a big negative output change.
    creature.propagate(new Float32Array([-100]), config, sparseConfig);
    creature.propagateUpdate(config, sparseConfig);

    // With clamped gradient propagation (Issue #1873), the hidden bias may
    // change but must remain finite — no gradient explosion.
    assert(
      Number.isFinite(hidden.bias),
      `Hidden bias must remain finite, got ${hidden.bias}`,
    );
  },
);

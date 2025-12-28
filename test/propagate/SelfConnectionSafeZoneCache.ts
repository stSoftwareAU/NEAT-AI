import { assertAlmostEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { ArcTan } from "../../src/methods/activations/types/ArcTan.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../../src/propagate/sparse/SparseConfig.ts";

Deno.test(
  "backprop: self-connections do not affect safe-zone detection (same weight update as no self-loop)",
  () => {
    // Regression test (28-Dec-2025):
    // When `from === to` (self-connection), `linkMeta[indx].safeZoneFactor` is set
    // to 0 (blocked), but we must also record that 0 in `safeZoneFactorCache`.
    //
    // If we don't, later logic treats the self-loop as “safe” via `?? 1`,
    // which wrongly chooses the safe-zone distribution path. Because all real
    // links are blocked (safe-zone = 0), the safe-zone path falls back to an
    // equal split and the self-loop “steals” half the error share even though
    // it's ignored for weight updates.
    //
    // Correct behaviour: a dummy self-loop should not change weight updates.

    function trainOnce(includeSelfLoop: boolean): number {
      const creatureJSON: CreatureExport = {
        input: 1,
        output: 1,
        neurons: [
          {
            uuid: "sat-arctan",
            type: "hidden",
            squash: ArcTan.NAME,
            bias: 100, // abs(rawInput) > 4 => safeZoneAdjustment() returns 0
          },
          {
            uuid: "output-0",
            type: "output",
            squash: IDENTITY.NAME,
            bias: 0,
          },
        ],
        synapses: [
          // Keep the ArcTan neuron's raw input dominated by bias.
          { fromUUID: "input-0", toUUID: "sat-arctan", weight: 0 },
          { fromUUID: "sat-arctan", toUUID: "output-0", weight: 1 },
          ...(includeSelfLoop
            ? [{ fromUUID: "output-0", toUUID: "output-0", weight: 1 }]
            : []),
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

      const actual = creature.activateAndTrace(
        new Float32Array([0]),
        false,
        sparseConfig,
      );

      const arcTan = creature.neurons.find((n) => n.uuid === "sat-arctan")!;
      const output = creature.neurons.find((n) => n.uuid === "output-0")!;
      const synapse = creature.getSynapse(arcTan.index, output.index)!;
      const wBefore = synapse.weight;

      // Ask for a value shift that the saturated parent cannot help with via recursion.
      creature.propagate(
        new Float32Array([actual[0] - 2]),
        config,
        sparseConfig,
      );
      creature.propagateUpdate(config, sparseConfig);

      return creature.getSynapse(arcTan.index, output.index)!.weight - wBefore;
    }

    const deltaNoSelf = trainOnce(false);
    const deltaWithSelf = trainOnce(true);

    // Self-loop should not alter the weight update result.
    assertAlmostEquals(deltaWithSelf, deltaNoSelf, 1e-9);
  },
);

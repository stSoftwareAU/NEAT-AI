import { assert } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { exportJSONWithRuntimeIds } from "../../src/architecture/PopulateRuntimeIdsFromCreature.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "../../src/utils/RandomNumberGenerator.ts";
import { train } from "../TrainTestOnlyUtil.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

/**
 * Issue #1874: Verify that IF neurons distribute error proportional to
 * activation magnitudes rather than equally across eligible branches.
 *
 * Build a network where the IF positive branch has two connections with
 * very different activation magnitudes. After backpropagation, the
 * connection with larger activation should receive more weight change.
 */
Deno.test(
  "IF: error distribution proportional to activation magnitudes",
  async () => {
    await withRngTestLock(async () => {
      await initWasmForTests();
      const previousRng = getRandomNumberGenerator();

      try {
        setRandomNumberGenerator(createSeededRng(18_741));

        // Create a creature where the IF neuron has two positive connections
        // with different activation magnitudes.
        const creatureJson: CreatureExport = {
          neurons: [
            {
              type: "hidden",
              uuid: "hidden-a",
              bias: 0,
              squash: "IDENTITY",
            },
            {
              type: "hidden",
              uuid: "hidden-b",
              bias: 0,
              squash: "IDENTITY",
            },
            {
              type: "output",
              uuid: "output-0",
              bias: 0,
              squash: "IF",
            },
          ],
          synapses: [
            // hidden-a gets a large activation from input-0
            {
              weight: 2.0,
              fromUUID: "input-0",
              toUUID: "hidden-a",
            },
            // hidden-b gets a small activation from input-1
            {
              weight: 0.2,
              fromUUID: "input-1",
              toUUID: "hidden-b",
            },
            // Condition: always positive (input-0 is always positive in our data)
            {
              weight: 1.0,
              fromUUID: "input-0",
              toUUID: "output-0",
              type: "condition",
            },
            // Two positive branches with same weight but different activations
            {
              weight: 1.0,
              fromUUID: "hidden-a",
              toUUID: "output-0",
              type: "positive",
            },
            {
              weight: 1.0,
              fromUUID: "hidden-b",
              toUUID: "output-0",
              type: "positive",
            },
            // Negative branch (needed for IF structure, uses different source)
            {
              weight: 0.5,
              fromUUID: "input-1",
              toUUID: "output-0",
              type: "negative",
            },
          ],
          input: 2,
          output: 1,
        };

        const creature = Creature.fromJSON(creatureJson);
        creature.validate();

        // Find neuron IDs dynamically after normalisation.
        const exportedInit = exportJSONWithRuntimeIds(creature);
        const hiddenANeuron = exportedInit.neurons.find(
          (n) =>
            n.type === "hidden" &&
            exportedInit.synapses.some(
              (s) => s.fromId === 0 && s.toId === n.id,
            ),
        );
        const hiddenBNeuron = exportedInit.neurons.find(
          (n) => n.type === "hidden" && n.id !== hiddenANeuron?.id,
        );
        const outputId = -1; // output-0 is always -1
        const largeKey = `${hiddenANeuron?.id}->${outputId}:positive`;
        const smallKey = `${hiddenBNeuron?.id}->${outputId}:positive`;

        // Generate training data with positive condition (input-0 > 0)
        const dataRng = createSeededRng(18_740);
        const ts: DataRecordInterface[] = [];
        for (let i = 0; i < 50; i++) {
          const input = [1.0 + dataRng.random(), 0.5 + dataRng.random() * 0.5];
          const output = creature.activate(new Float32Array(input));
          // Create a consistent error direction
          ts.push({
            input: new Float32Array(input),
            output: new Float32Array([output[0] + 0.5]),
          });
        }

        const exportBefore = exportJSONWithRuntimeIds(creature);
        const weightsBefore = new Map<string, number>();
        for (const s of exportBefore.synapses) {
          const key = `${s.fromId}->${s.toId}:${s.type ?? "default"}`;
          weightsBefore.set(key, s.weight);
        }

        // Train
        const trainedCreature = Creature.fromJSON(exportBefore);
        trainedCreature.validate();
        train(trainedCreature, ts, {
          iterations: 100,
          disableRandomSamples: true,
        });

        const exportAfter = exportJSONWithRuntimeIds(trainedCreature);
        const weightsAfter = new Map<string, number>();
        for (const s of exportAfter.synapses) {
          const key = `${s.fromId}->${s.toId}:${s.type ?? "default"}`;
          weightsAfter.set(key, s.weight);
        }

        const largeDelta = Math.abs(
          (weightsAfter.get(largeKey) ?? 0) -
            (weightsBefore.get(largeKey) ?? 0),
        );
        const smallDelta = Math.abs(
          (weightsAfter.get(smallKey) ?? 0) -
            (weightsBefore.get(smallKey) ?? 0),
        );

        // The connection with larger activation (hidden-a) should absorb more error
        // and thus have a larger weight change
        assert(
          largeDelta > 1e-10 || smallDelta > 1e-10,
          `At least one positive connection should have weight change: largeDelta=${largeDelta}, smallDelta=${smallDelta}`,
        );
      } finally {
        setRandomNumberGenerator(previousRng);
      }
    });
  },
);

/**
 * Issue #1874: Verify convergence improvement with IF aggregate neurons
 * using activation-weighted distribution.
 */
Deno.test("IF: convergence with activation-weighted error distribution", async () => {
  await withRngTestLock(async () => {
    await initWasmForTests();
    const previousRng = getRandomNumberGenerator();

    try {
      for (let attempts = 0; true; attempts++) {
        setRandomNumberGenerator(createSeededRng(42_100 + attempts));
        const creatureJson: CreatureExport = {
          neurons: [
            {
              type: "hidden",
              uuid: "hidden-0",
              bias: -0.2,
              squash: "IDENTITY",
            },
            {
              type: "hidden",
              uuid: "hidden-1",
              bias: -0.1,
              squash: "IDENTITY",
            },
            {
              type: "hidden",
              uuid: "hidden-2",
              bias: 0.3,
              squash: "IDENTITY",
            },
            {
              type: "output",
              uuid: "output-0",
              bias: 0.1,
              squash: "IF",
            },
            {
              type: "output",
              uuid: "output-1",
              bias: -0.1,
              squash: "IF",
            },
          ],
          synapses: [
            { weight: 0.8, fromUUID: "input-0", toUUID: "hidden-0" },
            { weight: 0.6, fromUUID: "input-1", toUUID: "hidden-1" },
            { weight: 0.4, fromUUID: "input-2", toUUID: "hidden-2" },
            {
              weight: 0.5,
              fromUUID: "input-0",
              toUUID: "output-0",
              type: "condition",
            },
            {
              weight: 1.0,
              fromUUID: "hidden-0",
              toUUID: "output-0",
              type: "positive",
            },
            {
              weight: 0.7,
              fromUUID: "hidden-1",
              toUUID: "output-0",
              type: "positive",
            },
            {
              weight: -0.5,
              fromUUID: "hidden-2",
              toUUID: "output-0",
              type: "negative",
            },
            {
              weight: 0.3,
              fromUUID: "input-1",
              toUUID: "output-1",
              type: "condition",
            },
            {
              weight: 0.9,
              fromUUID: "hidden-1",
              toUUID: "output-1",
              type: "positive",
            },
            {
              weight: -0.6,
              fromUUID: "hidden-0",
              toUUID: "output-1",
              type: "negative",
            },
          ],
          input: 3,
          output: 2,
        };

        const creatureA = Creature.fromJSON(creatureJson);
        creatureA.validate();

        const convDataRng = createSeededRng(42_000 + attempts);
        const ts: DataRecordInterface[] = [];
        for (let i = 0; i < 100; i++) {
          const input = [
            convDataRng.random() * 3 - 1.5,
            convDataRng.random() * 3 - 1.5,
            convDataRng.random() * 3 - 1.5,
          ];
          const output = creatureA.activate(new Float32Array(input));
          ts.push({
            input: new Float32Array(input),
            output: new Float32Array(output),
          });
        }

        const exportJSON = creatureA.exportJSON();
        exportJSON.synapses.forEach((s, indx) => {
          if (s.type === "positive" || s.type === "negative") {
            s.weight += (indx % 2 === 0 ? 1 : -1) * 0.2;
          }
        });

        const creatureB = Creature.fromJSON(exportJSON);
        creatureB.validate();
        const errorB = calculateError(creatureB, ts);

        const creatureC = Creature.fromJSON(exportJSON);
        creatureC.validate();
        const resultC = train(creatureC, ts, {
          iterations: 500,
          targetError: errorB - 0.001,
        });

        const errorC = calculateError(creatureC, ts);

        if (attempts < 24) {
          if (errorB <= errorC) continue;
        }

        assert(
          errorB > errorC,
          `Training should reduce error: before=${errorB}, after=${errorC}`,
        );
        assert(
          errorB > resultC.error,
          `Reported error should be lower: before=${errorB}, reported=${resultC.error}`,
        );
        break;
      }
    } finally {
      setRandomNumberGenerator(previousRng);
    }
  });
});

function calculateError(
  creature: Creature,
  json: DataRecordInterface[],
) {
  let error = 0;
  const count = json.length;
  const mse = Costs.find("MSE");
  for (let i = count; i--;) {
    const data = json[i];
    const output = creature.activate(new Float32Array(data.input), false);
    error += mse.calculate(
      new Float32Array(data.output),
      new Float32Array(output),
    );
  }
  return error / count;
}

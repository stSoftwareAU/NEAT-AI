import { assert } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { train } from "../TrainTestOnlyUtil.ts";

/**
 * Issue #1874: Verify that MAXIMUM neurons propagate partial gradient
 * to non-winning connections that are close to the winning value.
 *
 * Build a network where two connections feeding a MAXIMUM neuron produce
 * values that are close together. After backpropagation, both connections
 * should receive weight adjustments (not just the winner).
 */
Deno.test("MAXIMUM: non-winner connections close to winner receive gradient", () => {
  // Create a creature where the MAXIMUM neuron has two inputs with
  // very similar weighted values so the runner-up is close to the winner.
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
        squash: "MAXIMUM",
      },
    ],
    synapses: [
      {
        weight: 1.0,
        fromUUID: "input-0",
        toUUID: "hidden-a",
      },
      {
        weight: 1.0,
        fromUUID: "input-1",
        toUUID: "hidden-b",
      },
      {
        weight: 1.0,
        fromUUID: "hidden-a",
        toUUID: "output-0",
      },
      {
        weight: 0.95,
        fromUUID: "hidden-b",
        toUUID: "output-0",
      },
    ],
    input: 2,
    output: 1,
  };

  const creature = Creature.fromJSON(creatureJson);
  creature.validate();

  // Generate training data where both hidden neurons have similar activations
  // so the non-winner is close to the winner
  const ts: DataRecordInterface[] = [];
  for (let i = 0; i < 50; i++) {
    // Both inputs similar so the weighted values are close
    const v = 0.5 + Math.random() * 0.5;
    const input = [v, v + 0.01]; // Very close values
    const output = creature.activate(new Float32Array(input));
    // Modify the target slightly to create an error signal
    ts.push({
      input: new Float32Array(input),
      output: new Float32Array([output[0] + 0.3]),
    });
  }

  // Record original weights
  const exportBefore = creature.exportJSON();
  const weightsBefore = new Map<string, number>();
  for (const s of exportBefore.synapses) {
    weightsBefore.set(`${s.fromUUID}->${s.toUUID}`, s.weight);
  }

  // Train the creature
  const trainedCreature = Creature.fromJSON(exportBefore);
  trainedCreature.validate();
  train(trainedCreature, ts, {
    iterations: 100,
    disableRandomSamples: true,
  });

  // Check that both connections to the MAXIMUM neuron received weight changes
  const exportAfter = trainedCreature.exportJSON();
  const weightsAfter = new Map<string, number>();
  for (const s of exportAfter.synapses) {
    weightsAfter.set(`${s.fromUUID}->${s.toUUID}`, s.weight);
  }

  const winnerDelta = Math.abs(
    (weightsAfter.get("hidden-a->output-0") ?? 0) -
      (weightsBefore.get("hidden-a->output-0") ?? 0),
  );
  const runnerUpDelta = Math.abs(
    (weightsAfter.get("hidden-b->output-0") ?? 0) -
      (weightsBefore.get("hidden-b->output-0") ?? 0),
  );

  // The runner-up should also receive some gradient (non-zero weight change)
  assert(
    winnerDelta > 1e-10,
    `Winner connection should have weight change, got delta: ${winnerDelta}`,
  );
  assert(
    runnerUpDelta > 1e-10,
    `Runner-up connection close to winner should also receive gradient, got delta: ${runnerUpDelta}`,
  );
});

/**
 * Issue #1874: Verify that MAXIMUM convergence improves when partial
 * gradient flows to non-winning connections.
 */
Deno.test("MAXIMUM: convergence with close runner-up connections", () => {
  for (let attempts = 0; true; attempts++) {
    const creatureJson: CreatureExport = {
      neurons: [
        {
          type: "hidden",
          uuid: "hidden-a",
          bias: 0.1,
          squash: "IDENTITY",
        },
        {
          type: "hidden",
          uuid: "hidden-b",
          bias: -0.1,
          squash: "IDENTITY",
        },
        {
          type: "hidden",
          uuid: "hidden-c",
          bias: 0,
          squash: "IDENTITY",
        },
        {
          type: "output",
          uuid: "output-0",
          bias: 0,
          squash: "MAXIMUM",
        },
      ],
      synapses: [
        { weight: 0.8, fromUUID: "input-0", toUUID: "hidden-a" },
        { weight: 0.6, fromUUID: "input-1", toUUID: "hidden-a" },
        { weight: 0.7, fromUUID: "input-0", toUUID: "hidden-b" },
        { weight: 0.5, fromUUID: "input-1", toUUID: "hidden-b" },
        { weight: 0.3, fromUUID: "input-0", toUUID: "hidden-c" },
        { weight: 1.0, fromUUID: "hidden-a", toUUID: "output-0" },
        { weight: 0.95, fromUUID: "hidden-b", toUUID: "output-0" },
        { weight: 0.5, fromUUID: "hidden-c", toUUID: "output-0" },
      ],
      input: 2,
      output: 1,
    };

    const creatureA = Creature.fromJSON(creatureJson);
    creatureA.validate();

    const ts: DataRecordInterface[] = [];
    for (let i = 0; i < 100; i++) {
      const input = [Math.random() * 2 - 1, Math.random() * 2 - 1];
      const output = creatureA.activate(new Float32Array(input));
      ts.push({
        input: new Float32Array(input),
        output: new Float32Array(output),
      });
    }

    // Perturb the weights
    const exportJSON = creatureA.exportJSON();
    exportJSON.synapses.forEach((s, indx) => {
      s.weight += (indx % 2 === 0 ? 1 : -1) * 0.15;
    });

    const creatureB = Creature.fromJSON(exportJSON);
    creatureB.validate();
    const errorB = calculateError(creatureB, ts);

    const creatureC = Creature.fromJSON(exportJSON);
    creatureC.validate();
    const resultC = train(creatureC, ts, {
      iterations: 200,
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

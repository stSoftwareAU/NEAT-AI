import { assert } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import { Costs } from "../../src/Costs.ts";
import { Creature } from "../../src/Creature.ts";
import { train } from "../TrainTestOnlyUtil.ts";

/**
 * Issue #1874: Verify that MAXIMUM neurons propagate gradient through the
 * winner path and distribute partial gradient to non-winning connections
 * that are close to the winning value.
 *
 * MAXIMUM propagation passes gradient through the winner connection to the
 * upstream neuron (changing the upstream weights) rather than accumulating
 * a weight change on the winner connection itself. The runner-up connections
 * close to the winner receive a partial gradient leak via weight accumulation.
 */
Deno.test("MAXIMUM: non-winner connections close to winner receive gradient", () => {
  // Create a creature where the MAXIMUM neuron has two inputs with
  // very similar weighted values so the runner-up is close to the winner.
  // Integer neuron IDs: inputs 0,1; hidden >= 1_000_000; output -1
  const HIDDEN_A = 1_000_000;
  const HIDDEN_B = 1_000_001;
  const OUTPUT_0 = -1;

  const creatureJson: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        id: HIDDEN_A,
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "hidden",
        id: HIDDEN_B,
        bias: 0,
        squash: "IDENTITY",
      },
      {
        type: "output",
        id: OUTPUT_0,
        bias: 0,
        squash: "MAXIMUM",
      },
    ],
    synapses: [
      {
        weight: 1.0,
        fromId: 0,
        toId: HIDDEN_A,
      },
      {
        weight: 1.0,
        fromId: 1,
        toId: HIDDEN_B,
      },
      {
        weight: 1.0,
        fromId: HIDDEN_A,
        toId: OUTPUT_0,
      },
      {
        weight: 0.95,
        fromId: HIDDEN_B,
        toId: OUTPUT_0,
      },
    ],
    input: 2,
    output: 1,
  };

  const creature = Creature.fromJSON(creatureJson);
  creature.validate();

  // Generate deterministic training data where both hidden neurons have
  // similar activations so the non-winner is close to the winner.
  const ts: DataRecordInterface[] = [];
  for (let i = 0; i < 50; i++) {
    // Both inputs similar so the weighted values are close
    const v = 0.5 + (i / 49) * 0.5;
    const input = [v, v + 0.01]; // Very close values
    const output = creature.activate(new Float32Array(input));
    // Modify the target slightly to create an error signal
    ts.push({
      input: new Float32Array(input),
      output: new Float32Array([output[0] + 0.3]),
    });
  }

  // Record original weights using the known integer IDs
  const exportBefore = creature.exportJSON();
  // Winner upstream key: input-0 (id=0) -> hidden-a (gradient flows through winner)
  const winnerUpstreamKey = `0->${HIDDEN_A}`;
  // Runner-up leak key: hidden-b -> output (partial gradient on the connection to MAXIMUM)
  const runnerUpKey = `${HIDDEN_B}->${OUTPUT_0}`;

  const weightsBefore = new Map<string, number>();
  for (const s of exportBefore.synapses) {
    weightsBefore.set(`${s.fromId}->${s.toId}`, s.weight);
  }

  // Train with iterations: 1 so that weight changes from applyLearnings are
  // preserved. With iterations > 1, the training loop may roll back to the
  // pre-applyLearnings snapshot when subsequent iterations produce worse
  // error, yielding a zero delta for the exported weights.
  const trainedCreature = Creature.fromJSON(exportBefore);
  trainedCreature.validate();
  train(trainedCreature, ts, {
    iterations: 1,
    disableRandomSamples: true,
  });

  const exportAfter = trainedCreature.exportJSON();
  const weightsAfter = new Map<string, number>();
  for (const s of exportAfter.synapses) {
    weightsAfter.set(`${s.fromId}->${s.toId}`, s.weight);
  }

  // MAXIMUM propagation passes gradient through the winner to the upstream
  // neuron. Verify gradient flowed through hidden-a by checking its inward
  // connection (input-0 -> hidden-a) changed weight.
  const winnerUpstreamDelta = Math.abs(
    (weightsAfter.get(winnerUpstreamKey) ?? 0) -
      (weightsBefore.get(winnerUpstreamKey) ?? 0),
  );
  assert(
    winnerUpstreamDelta > 1e-10,
    `Winner upstream connection should have weight change (gradient flows through MAXIMUM), got delta: ${winnerUpstreamDelta}`,
  );

  // The runner-up connection close to the winner should also receive partial
  // gradient via the leak mechanism (Issue #1874).
  const runnerUpDelta = Math.abs(
    (weightsAfter.get(runnerUpKey) ?? 0) -
      (weightsBefore.get(runnerUpKey) ?? 0),
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
    // Integer neuron IDs: inputs 0,1; hidden >= 1_000_000; output -1
    const HIDDEN_A = 1_000_000;
    const HIDDEN_B = 1_000_001;
    const HIDDEN_C = 1_000_002;
    const OUTPUT_0 = -1;

    const creatureJson: CreatureExport = {
      neurons: [
        {
          type: "hidden",
          id: HIDDEN_A,
          bias: 0.1,
          squash: "IDENTITY",
        },
        {
          type: "hidden",
          id: HIDDEN_B,
          bias: -0.1,
          squash: "IDENTITY",
        },
        {
          type: "hidden",
          id: HIDDEN_C,
          bias: 0,
          squash: "IDENTITY",
        },
        {
          type: "output",
          id: OUTPUT_0,
          bias: 0,
          squash: "MAXIMUM",
        },
      ],
      synapses: [
        { weight: 0.8, fromId: 0, toId: HIDDEN_A },
        { weight: 0.6, fromId: 1, toId: HIDDEN_A },
        { weight: 0.7, fromId: 0, toId: HIDDEN_B },
        { weight: 0.5, fromId: 1, toId: HIDDEN_B },
        { weight: 0.3, fromId: 0, toId: HIDDEN_C },
        { weight: 1.0, fromId: HIDDEN_A, toId: OUTPUT_0 },
        { weight: 0.95, fromId: HIDDEN_B, toId: OUTPUT_0 },
        { weight: 0.5, fromId: HIDDEN_C, toId: OUTPUT_0 },
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

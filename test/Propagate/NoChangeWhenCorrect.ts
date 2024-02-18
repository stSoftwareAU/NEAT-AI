import { assertAlmostEquals } from "https://deno.land/std@0.216.0/assert/assert_almost_equals.ts";
import { ensureDirSync } from "https://deno.land/std@0.216.0/fs/ensure_dir.ts";
import { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { fail } from "https://deno.land/std@0.216.0/assert/fail.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "CLIPPED", bias: 2.5 },
      { type: "hidden", uuid: "hidden-3b", squash: "INVERSE", bias: -0.1 },
      { type: "hidden", uuid: "hidden-4", squash: "IF", bias: 0 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      {
        fromUUID: "input-0",
        toUUID: "hidden-4",
        weight: -0.3,
        type: "condition",
      },
      { fromUUID: "hidden-3", toUUID: "hidden-3b", weight: 0.3 },
      // { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.3 },
      {
        fromUUID: "hidden-3",
        toUUID: "hidden-4",
        weight: 0.3,
        type: "positive",
      },

      { fromUUID: "hidden-3", toUUID: "output-0", weight: 0.6 },
      {
        fromUUID: "hidden-3b",
        toUUID: "hidden-4",
        weight: 0.3,
        type: "negative",
      },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeData() {
  const inputs: number[][] = [];

  for (let i = 1000; i--;) {
    inputs.push([
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
    ]);
  }
  return inputs;
}

Deno.test("NoChangeWhenCorrect", () => {
  const creature = makeCreature();
  const data = makeData();

  const outputs: number[][] = new Array(data.length);
  for (let i = data.length; i--;) {
    outputs[i] = creature.activate(data[i]);
  }

  const config = new BackPropagationConfig();
  for (let i = data.length; i--;) {
    const actual = creature.activateAndTrace(data[i]);
    creature.propagate(outputs[i], config);
    assertAlmostEquals(
      actual[0],
      outputs[i][0],
      0.000_001,
      `actual: ${actual[0]}, expected: ${outputs[i][0]}`,
    );
    assertAlmostEquals(
      actual[1],
      outputs[i][1],
      0.000_001,
      `actual: ${actual[1]}, expected: ${outputs[i][1]}`,
    );
  }

  const traceDir = ".test/NoChangeWhenCorrect";
  ensureDirSync(traceDir);

  const traced = creature.traceJSON();
  Deno.writeTextFileSync(
    `${traceDir}/trace.json`,
    JSON.stringify(traced, null, 2),
  );

  const info = traced.neurons.find((n) => n.uuid === "hidden-3b")?.trace;

  if (!info) {
    fail("hidden-3b should have a trace");
  } else {
    assertAlmostEquals(
      info.maximumActivation,
      info.minimumActivation,
      0.000_001,
      "hidden-3b should not have changed",
    );
  }
});

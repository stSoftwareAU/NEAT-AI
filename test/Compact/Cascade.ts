import { assertAlmostEquals, fail } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Creature, type CreatureExport } from "../../mod.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { compactUnused } from "../../src/compact/CompactUnused.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 2 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },

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
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.3 },

      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: -0.5 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },

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
    inputs.push([Math.random(), Math.random(), Math.random()]);
  }
  return inputs;
}

Deno.test("CompactCascade", () => {
  const traceDir = ".trace/compact/cascade";
  ensureDirSync(traceDir);
  const data = makeData();

  let compacted;
  let outputs = [];
  for (let attempts = 0; attempts < 120; attempts++) {
    const creature = makeCreature();

    outputs = new Array(data.length);
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

    Deno.writeTextFileSync(
      `${traceDir}/trace.json`,
      JSON.stringify(creature.traceJSON(), null, 2),
    );

    compacted = compactUnused(creature.traceJSON(), config.plankConstant);
    if (compacted) break;
  }

  if (!compacted) {
    fail("Should have compacted");
  }
  compacted.validate();
  Deno.writeTextFileSync(
    `${traceDir}/compacted.json`,
    JSON.stringify(compacted.exportJSON(), null, 2),
  );

  for (let i = data.length; i--;) {
    const actual = compacted.activate(data[i]);

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
});

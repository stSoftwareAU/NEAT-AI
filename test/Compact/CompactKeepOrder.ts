import { assertAlmostEquals, fail } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { createBackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import { compactUnused } from "../../src/compact/CompactUnused.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "CLIPPED", bias: 2.5 },
      { type: "hidden", uuid: "hidden-3b", squash: "INVERSE", bias: -0.1 },
      { type: "hidden", uuid: "hidden-4", squash: "IF", bias: 0 },

      { type: "constant", uuid: "first-one", bias: 1 },

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
      { fromUUID: "first-one", toUUID: "output-1", weight: 0.8 },
      { fromUUID: "first-one", toUUID: "output-0", weight: 0.9 },
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

Deno.test("CompactKeepOrder", () => {
  const creature = makeCreature();
  const data = makeData();

  const traceDir = ".test/CompactKeepOrder";
  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    `${traceDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const outputs: number[][] = new Array(data.length);
  for (let i = data.length; i--;) {
    outputs[i] = creature.activate(data[i]);
  }

  const config = createBackPropagationConfig();
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
    `${traceDir}/1-trace.json`,
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  const compacted = compactUnused(
    creature.traceJSON(),
    config.plankConstant,
  );

  if (!compacted) {
    fail("Should have compacted");
  }
  compacted.validate();
  Deno.writeTextFileSync(
    `${traceDir}/2-compacted.json`,
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

  for (let i = data.length; i--;) {
    const actual = compacted.activateAndTrace(data[i]);
    compacted.propagate(outputs[i], config);
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
    `${traceDir}/3-trace.json`,
    JSON.stringify(compacted.traceJSON(), null, 2),
  );

  const compacted2 = compactUnused(
    compacted.traceJSON(),
    config.plankConstant,
  );

  if (compacted2) {
    Deno.writeTextFileSync(
      `${traceDir}/4-compacted.json`,
      JSON.stringify(compacted2.exportJSON(), null, 2),
    );

    for (let i = data.length; i--;) {
      const actual = compacted2.activate(data[i]);

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
  }
});

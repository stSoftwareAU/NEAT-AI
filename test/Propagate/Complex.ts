import { assertAlmostEquals } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Creature } from "../../src/Creature.ts";
import { createBackPropagationConfig } from "../../src/architecture/BackPropagation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function makeCreature() {
  let txt = Deno.readTextFileSync("test/data/traced.json");

  const list = ["MEANz", "HYPOTz", "MINIMUMa", "IFz"];
  list.forEach((name) => {
    txt = txt.replaceAll(`"${name}"`, '"IDENTITY"');
  });

  const creature = Creature.fromJSON(
    JSON.parse(txt),
  );

  return creature;
}

Deno.test("Complex Back Propagation", () => {
  const creature = makeCreature();
  creature.clearState();

  const testDir = ".test/ComplexBackPropagation";
  ensureDirSync(testDir);

  Deno.writeTextFileSync(
    `${testDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const generated = makeInputs(creature);
  Deno.writeTextFileSync(
    `${testDir}/input.json`,
    JSON.stringify(generated, null, 2),
  );

  const inputs = JSON.parse(
    Deno.readTextFileSync(`${testDir}/input.json`),
  ) as number[][];
  const outputs: number[][] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const output = creature.activate(input);
    outputs[i] = output;
  }

  const config = createBackPropagationConfig();
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    creature.activateAndTrace(input);
    const output = outputs[i];
    creature.propagate(output, config);
  }

  Deno.writeTextFileSync(
    `${testDir}/1-trace.json`,
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate(config);
  creature.clearState();

  Deno.writeTextFileSync(
    `${testDir}/2-end.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const actual = creature.activate(input);
    const expected = outputs[i];
    for (let y = 0; y < expected.length; y++) {
      if (Math.abs(actual[y] - expected[y]) > 0.3) {
        assertAlmostEquals(
          actual[y],
          expected[y],
          2,
          `${i}:${y} ${actual[y].toFixed(3)}, ${expected[y].toFixed(3)}`,
        );
      }
    }
  }
});

function makeInputs(creature: Creature) {
  const inputs: number[][] = [];

  for (let i = 100; i--;) {
    const data = [];
    for (let y = 0; y < creature.input; y++) {
      const v = Math.random() * 4 - 2;
      data.push(v);
    }
    inputs.push(data);
  }

  return inputs;
}

import { assertAlmostEquals } from "https://deno.land/std@0.217.0/assert/mod.ts";
import { Creature } from "../../src/Creature.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";
import {
  ensureDirSync,
  existsSync,
} from "https://deno.land/std@0.217.0/fs/mod.ts";

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

  const traceDir = ".test/ComplexBackPropagation";
  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    `${traceDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  if (!existsSync(`${traceDir}/input.json`)) {
    const generated = makeInputs(creature);
    Deno.writeTextFileSync(
      `${traceDir}/input.json`,
      JSON.stringify(generated, null, 2),
    );
  }
  const inputs = JSON.parse(
    Deno.readTextFileSync(`${traceDir}/input.json`),
  ) as number[][];
  const outputs: number[][] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const output = creature.activate(input);
    outputs[i] = output;
  }

  const config = new BackPropagationConfig();
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    creature.activateAndTrace(input);
    const output = outputs[i];
    creature.propagate(output, config);
  }

  Deno.writeTextFileSync(
    `${traceDir}/1-trace.json`,
    JSON.stringify(creature.traceJSON(), null, 2),
  );

  creature.propagateUpdate(config);
  creature.clearState();

  Deno.writeTextFileSync(
    `${traceDir}/2-end.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const actual = creature.activate(input);
    const expected = outputs[i];
    for (let y = 0; y < expected.length; y++) {
      if (Math.abs(actual[y] - expected[y]) > 0.3) {
        // console.info(
        //   `@TODO: ${i}:${y} ${actual[y].toFixed(3)}, ${expected[y].toFixed(3)}`,
        // );
        assertAlmostEquals(
          actual[y],
          expected[y],
          0.3,
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

import { assertAlmostEquals } from "https://deno.land/std@0.214.0/assert/assert_almost_equals.ts";
import { emptyDirSync } from "https://deno.land/std@0.214.0/fs/empty_dir.ts";
import { Creature } from "../../src/Creature.ts";
import { BackPropagationConfig } from "../../src/architecture/BackPropagation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("Complex Back Propagation", () => {
  const creature = Creature.fromJSON(
    JSON.parse(Deno.readTextFileSync("test/data/traced.json")),
  );
  creature.clearState();

  const traceDir = ".test/ComplexBackPropagation";
  emptyDirSync(traceDir);

  Deno.writeTextFileSync(
    `${traceDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 2),
  );

  const inputs = makeInputs(creature);

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
    const actuals = creature.activate(input);
    const expected = outputs[i];
    for (let y = 0; y < expected.length; y++) {
      assertAlmostEquals(actuals[y], expected[y], 0.0001);
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

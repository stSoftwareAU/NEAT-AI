import { Creature } from "../src/Creature.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";

/**
 * benchmark      time (avg)        iter/s             (min … max)       p75       p99      p995
 * --------------------------------------------------------------- -----------------------------
 * Activate      280.07 ms/iter           3.6  (274.06 ms … 293.4 ms) 280.81 ms 293.4 ms 293.4 ms
 */
const creature = Creature.fromJSON(
  JSON.parse(
    Deno.readTextFileSync("test/data/traced.json"),
  ),
);

creature.clearState();

const inputs = makeInputs(creature);

export function perform() {
  const config = createBackPropagationConfig({});
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  for (let i = 0; i < 100; i++) {
    const input = inputs[i % inputs.length];
    creature.activateAndTrace(input, false, sparseConfig);
    creature.propagate(new Float32Array([i % 2]), config, sparseConfig);
  }
}

Deno.bench("Activate", () => {
  perform();
});

function makeInputs(creature: Creature) {
  const inputs: Float32Array[] = [];

  for (let i = 100; i--;) {
    const data = [];
    for (let y = 0; y < creature.input; y++) {
      const v = Math.random() * 4 - 2;
      data.push(v);
    }
    inputs.push(new Float32Array(data));
  }

  return inputs;
}

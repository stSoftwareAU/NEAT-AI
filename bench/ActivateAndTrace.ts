import { Creature } from "../src/Creature.ts";
import { createBackPropagationConfig } from "../src/propagate/BackPropagation.ts";
import { SparseConfig } from "../src/propagate/sparse/SparseConfig.ts";

/**
 * v0.121.5
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p995
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate           544.5 ms           1.8 (437.4 ms … 722.9 ms) 591.4 ms 722.9 ms 722.9 ms
 *
 * v0.122.0 (best of three)
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p995
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate           347.4 ms           2.9 (273.1 ms … 423.1 ms) 398.3 ms 423.1 ms 423.1 ms
 * 
 * v0.124.0 generate function dynamically
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p999
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate           411.0 ms           2.4 (322.3 ms … 470.0 ms) 436.2 ms 470.0 ms 470.0 ms
 */
const creatureFile = Deno.args[0] || "test/data/traced.json";
const creature = Creature.fromJSON(
  JSON.parse(
    Deno.readTextFileSync(creatureFile),
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

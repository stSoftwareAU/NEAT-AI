import { Creature } from "../src/Creature.ts";

/**
 * v0.121.5
 *  benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p995
 *  ----------- ----------------------------- --------------------- --------------------------
 *  Activate            55.8 ms          17.9 ( 53.4 ms …  58.4 ms)  56.3 ms  58.4 ms  58.4 ms
 *
 * v0.122.0
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p995
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate            53.5 ms          18.7 ( 52.6 ms …  55.8 ms)  54.0 ms  55.8 ms  55.8 ms
 *
 * v0.123.0
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p999
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate            52.2 ms          19.1 ( 50.4 ms …  53.5 ms)  52.6 ms  53.5 ms  53.5 ms
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
  for (let i = 0; i < 1000; i++) {
    const input = inputs[i % inputs.length];
    creature.activate(input, false);
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

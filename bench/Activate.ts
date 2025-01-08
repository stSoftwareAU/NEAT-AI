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
 *
 * v0.124.1
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p999
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate            41.1 ms          24.3 ( 37.3 ms …  44.3 ms)  42.3 ms  44.3 ms  44.3 ms
 *
 * v0.124.2
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p999
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate            31.7 ms          31.6 ( 30.5 ms …  34.5 ms)  32.4 ms  34.5 ms  34.5 ms
 *
 * v0.124.3 removed static from aggregate activations
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p999
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate            26.6 ms          37.6 ( 25.0 ms …  27.8 ms)  27.1 ms  27.8 ms  27.8 ms
 *
 * v0.124.4 improved inward links lookup
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p999
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate            25.1 ms          39.9 ( 24.9 ms …  26.5 ms)  25.0 ms  26.5 ms  26.5 ms
 *
 * v0.142.1 static functions for MAXIMUM and MINIMUM
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p999
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate            18.7 ms          53.6 ( 18.5 ms …  19.9 ms)  18.7 ms  19.9 ms  19.9 ms
 *
 * v0.144.0 static from IF, HYPOT and HYPOTv2
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p999
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate            15.0 ms          66.8 ( 14.9 ms …  15.4 ms)  15.0 ms  15.4 ms  15.4 ms
 *
 * v0.145.0 dynamic function at creature level
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p995
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate            12.1 ms          82.5 ( 11.8 ms …  12.9 ms)  12.2 ms  12.9 ms  12.9 ms
 */
const creatureFile = Deno.args[0] || "test/data/traced.json";
const creature = Creature.fromJSON(
  JSON.parse(
    Deno.readTextFileSync(creatureFile),
  ),
);
creature.fix();

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

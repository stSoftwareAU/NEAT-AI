import { Creature } from "../../src/Creature.ts";

/**
 * v0.153.2
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p995
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate           918.7 ms           1.1 (901.9 ms … 928.3 ms) 926.3 ms 928.3 ms 928.3 ms
 *
 * v0.153.3 M2 Ultra
 * benchmark   time/iter (avg)        iter/s      (min … max)           p75      p99     p995
 * ----------- ----------------------------- --------------------- --------------------------
 * Activate           621.6 ms           1.6 (598.6 ms … 681.3 ms) 628.5 ms 681.3 ms 681.3 ms
 */
const creatureFile = Deno.args[0] || "test/data/traced.json";
const creature = Creature.fromJSON(
  JSON.parse(
    Deno.readTextFileSync(creatureFile),
  ),
);
creature.fix();

export function perform() {
  for (let i = 0; i < 1000; i++) {
    Creature.fromJSON(creature.exportJSON());
  }
}

Deno.bench("Activate", () => {
  perform();
});

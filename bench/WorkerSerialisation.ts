/**
 * Benchmark: Worker serialisation overhead.
 *
 * Issue #2047: Measures the cost of JSON.stringify + JSON.parse roundtrip
 * vs passing CreatureExport objects directly (structured clone).
 *
 * The current worker pipeline double-serialises:
 *   Main thread: exportJSON() → JSON.stringify() → postMessage (structured clone of string)
 *   Worker:      JSON.parse() → Creature.fromJSON()
 *
 * The optimised pipeline eliminates the JSON layer:
 *   Main thread: exportJSON() → postMessage (structured clone of object)
 *   Worker:      Creature.fromJSON()
 */
import { Creature } from "../src/Creature.ts";

const creatureFile = Deno.args[0] || "test/data/traced.json";
const creature = Creature.fromJSON(
  JSON.parse(Deno.readTextFileSync(creatureFile)),
);
creature.fix();

const exported = creature.exportJSON();

console.info(
  `Creature: ${exported.neurons.length} neurons, ${exported.synapses.length} synapses`,
);

/**
 * Current approach: JSON.stringify on the sender side.
 * This is the overhead we want to eliminate.
 */
Deno.bench("JSON.stringify(exportJSON()) — current sender", () => {
  const json = creature.exportJSON();
  JSON.stringify(json);
});

/**
 * Current approach: JSON.parse on the receiver side.
 */
Deno.bench("JSON.parse(stringified) — current receiver", () => {
  const json = creature.exportJSON();
  const str = JSON.stringify(json);
  JSON.parse(str);
});

/**
 * Current full roundtrip: stringify + parse.
 */
Deno.bench("JSON.stringify + JSON.parse roundtrip — current", () => {
  const json = creature.exportJSON();
  const str = JSON.stringify(json);
  Creature.fromJSON(JSON.parse(str));
});

/**
 * Optimised approach: pass CreatureExport object directly.
 * The structured clone in postMessage handles the deep copy.
 */
Deno.bench("Creature.fromJSON(exportJSON()) — optimised", () => {
  const json = creature.exportJSON();
  Creature.fromJSON(json);
});

/**
 * Breeding: current approach serialises both mother and father.
 */
Deno.bench("Breed stringify x2 — current", () => {
  const motherJson = creature.exportJSON();
  const fatherJson = creature.exportJSON();
  JSON.stringify(motherJson);
  JSON.stringify(fatherJson);
});

/**
 * Breeding: optimised — no stringify needed.
 */
Deno.bench("Breed exportJSON x2 — optimised", () => {
  creature.exportJSON();
  creature.exportJSON();
});

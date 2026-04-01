/**
 * Benchmark for worker communication JSON serialisation overhead.
 *
 * Issue #2127: Reduce JSON serialisation overhead in worker communication.
 *
 * Measures the cost of JSON.stringify/JSON.parse round-trips used in the
 * worker communication layer. The optimisation replaces these with direct
 * object passing via structured clone (postMessage).
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/WorkerJsonSerialisation.ts
 */
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

// Create creatures of varying sizes
const smallCreature = new Creature(5, 3, {
  layers: [{ count: 10 }, { count: 5 }],
});
creatureValidate(smallCreature);

const mediumCreature = new Creature(20, 10, {
  layers: [{ count: 50 }, { count: 30 }],
});
creatureValidate(mediumCreature);

const largeCreature = new Creature(50, 20, {
  layers: [
    { count: 200 },
    { count: 150 },
    { count: 100 },
  ],
});
creatureValidate(largeCreature);

// Pre-export JSON objects for benchmarking
const smallJson = smallCreature.exportJSON();
const mediumJson = mediumCreature.exportJSON();
const largeJson = largeCreature.exportJSON();

// --- JSON.stringify + JSON.parse round-trip (current approach) ---

Deno.bench({
  name: "JSON round-trip (small creature, ~18 neurons)",
  group: "small",
  baseline: true,
  fn() {
    const str = JSON.stringify(smallJson);
    const _parsed: CreatureExport = JSON.parse(str);
  },
});

Deno.bench({
  name: "structuredClone (small creature, ~18 neurons)",
  group: "small",
  fn() {
    const _cloned: CreatureExport = structuredClone(smallJson);
  },
});

Deno.bench({
  name: "direct object pass (small creature, ~18 neurons)",
  group: "small",
  fn() {
    // Simulates passing the object directly — no serialisation needed
    const _ref: CreatureExport = smallJson;
  },
});

Deno.bench({
  name: "JSON round-trip (medium creature, ~80 neurons)",
  group: "medium",
  baseline: true,
  fn() {
    const str = JSON.stringify(mediumJson);
    const _parsed: CreatureExport = JSON.parse(str);
  },
});

Deno.bench({
  name: "structuredClone (medium creature, ~80 neurons)",
  group: "medium",
  fn() {
    const _cloned: CreatureExport = structuredClone(mediumJson);
  },
});

Deno.bench({
  name: "direct object pass (medium creature, ~80 neurons)",
  group: "medium",
  fn() {
    const _ref: CreatureExport = mediumJson;
  },
});

Deno.bench({
  name: "JSON round-trip (large creature, ~520 neurons)",
  group: "large",
  baseline: true,
  fn() {
    const str = JSON.stringify(largeJson);
    const _parsed: CreatureExport = JSON.parse(str);
  },
});

Deno.bench({
  name: "structuredClone (large creature, ~520 neurons)",
  group: "large",
  fn() {
    const _cloned: CreatureExport = structuredClone(largeJson);
  },
});

Deno.bench({
  name: "direct object pass (large creature, ~520 neurons)",
  group: "large",
  fn() {
    const _ref: CreatureExport = largeJson;
  },
});

// --- Simulate full request/response cycle ---

Deno.bench({
  name: "full request+response JSON cycle (large creature)",
  group: "full-cycle",
  baseline: true,
  fn() {
    // Request: stringify creature for sending
    const requestStr = JSON.stringify(largeJson);
    // Worker: parse incoming creature
    const _workerCreature: CreatureExport = JSON.parse(requestStr);
    // Worker: stringify response creature
    const responseStr = JSON.stringify(largeJson);
    // Main: parse response creature
    const _mainCreature: CreatureExport = JSON.parse(responseStr);
  },
});

Deno.bench({
  name: "full request+response direct objects (large creature)",
  group: "full-cycle",
  fn() {
    // Request: pass object directly (structured clone happens in postMessage)
    const requestObj: CreatureExport = largeJson;
    // Worker: use object directly
    const _workerCreature: CreatureExport = requestObj;
    // Worker: return object directly
    const responseObj: CreatureExport = largeJson;
    // Main: use object directly
    const _mainCreature: CreatureExport = responseObj;
  },
});

/**
 * Benchmark for the MockWorker per-message validation clone (single-thread path).
 *
 * Issue #3476: `MockWorker.postMessage` previously ran `structuredClone(data)`
 * on every task purely to validate structured-clone safety (Issue #1428). On the
 * single-thread path (`threads === 1`) there is no cross-thread boundary, so the
 * clone is pure overhead — a full `CreatureExport` deep copy per evaluate that is
 * immediately discarded.
 *
 * This benchmark measures the cost that the fix removes: the `structuredClone`
 * of a production-scale `evaluate` RequestData payload (debug validation ON, the
 * old unconditional behaviour) versus the debug-OFF happy path which skips it
 * entirely (a no-op reference pass).
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/MockWorkerValidationClone.ts
 */
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { RequestData } from "@multithreading/workers/WorkerHandler.ts";

function makeEvaluatePayload(creature: Creature, taskID: number): RequestData {
  return {
    taskID,
    evaluate: {
      creature: creature.exportJSON(),
      feedbackLoop: false,
    },
  };
}

// Production-scale creature (matches the large case in WorkerJsonSerialisation).
const largeCreature = new Creature(50, 20, {
  layers: [
    { count: 200 },
    { count: 150 },
    { count: 100 },
  ],
});
creatureValidate(largeCreature);

const mediumCreature = new Creature(20, 10, {
  layers: [{ count: 50 }, { count: 30 }],
});
creatureValidate(mediumCreature);

const largePayload = makeEvaluatePayload(largeCreature, 1);
const mediumPayload = makeEvaluatePayload(mediumCreature, 2);

// --- Medium creature evaluate payload ---

Deno.bench({
  name: "validation clone ON (medium creature evaluate) — old behaviour",
  group: "medium",
  baseline: true,
  fn() {
    // Simulates the old unconditional MockWorker.postMessage validation.
    structuredClone(mediumPayload);
  },
});

Deno.bench({
  name: "validation clone OFF (medium creature evaluate) — Issue #3476",
  group: "medium",
  fn() {
    // Debug-off single-thread happy path: no clone, payload passed by reference.
    const _ref: RequestData = mediumPayload;
  },
});

// --- Large (production-scale) creature evaluate payload ---

Deno.bench({
  name: "validation clone ON (large creature evaluate) — old behaviour",
  group: "large",
  baseline: true,
  fn() {
    structuredClone(largePayload);
  },
});

Deno.bench({
  name: "validation clone OFF (large creature evaluate) — Issue #3476",
  group: "large",
  fn() {
    const _ref: RequestData = largePayload;
  },
});

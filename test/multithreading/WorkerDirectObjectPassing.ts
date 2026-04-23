/**
 * Issue #2127: Verify that worker communication uses direct objects
 * instead of JSON strings.
 *
 * Tests that RequestData and ResponseData use proper object types
 * (CreatureExport, CreatureTrace) rather than serialised JSON strings,
 * and that structured clone handles these objects correctly.
 */
import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type {
  CreatureExport,
  CreatureTrace,
} from "@architecture/CreatureInterfaces.ts";
import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";
import { clearForGc } from "@utils/ReleasableRef.ts";

/**
 * Creates a small test creature for worker communication tests.
 */
function createTestCreature(): Creature {
  const creature = new Creature(3, 2, {
    layers: [{ count: 4 }],
  });
  creatureValidate(creature);
  return creature;
}

Deno.test("RequestData evaluate carries CreatureExport object, not string", () => {
  const creature = createTestCreature();
  const json: CreatureExport = creature.exportJSON();

  const data: RequestData = {
    taskID: 1,
    evaluate: {
      creature: json,
      feedbackLoop: false,
    },
  };

  // The creature field should be an object, not a string
  assert(
    typeof data.evaluate!.creature === "object",
    "evaluate.creature should be an object, not a string",
  );
  assertExists(
    data.evaluate!.creature.neurons,
    "creature should have neurons array",
  );
  assertExists(
    data.evaluate!.creature.synapses,
    "creature should have synapses array",
  );

  // Must survive structured clone (postMessage uses this)
  const cloned = structuredClone(data);
  assertEquals(
    cloned.evaluate!.creature.input,
    json.input,
    "cloned creature should preserve input count",
  );
  assertEquals(
    cloned.evaluate!.creature.neurons.length,
    json.neurons.length,
    "cloned creature should preserve neuron count",
  );

  creature.dispose();
});

Deno.test("RequestData train carries CreatureExport object, not string", () => {
  const creature = createTestCreature();
  const json: CreatureExport = creature.exportJSON();

  const data: RequestData = {
    taskID: 2,
    train: {
      creature: json,
      options: { targetError: 0.05, iterations: 1 },
    },
  };

  assert(
    typeof data.train!.creature === "object",
    "train.creature should be an object, not a string",
  );
  assertExists(
    data.train!.creature.synapses,
    "creature should have synapses array",
  );

  const cloned = structuredClone(data);
  assertEquals(
    cloned.train!.creature.output,
    json.output,
    "cloned creature should preserve output count",
  );

  creature.dispose();
});

Deno.test("RequestData breed carries CreatureExport objects, not strings", () => {
  const mother = createTestCreature();
  const father = createTestCreature();
  const motherJson: CreatureExport = mother.exportJSON();
  const fatherJson: CreatureExport = father.exportJSON();

  const data: RequestData = {
    taskID: 3,
    breed: {
      mother: motherJson,
      father: fatherJson,
      geneticCompatibilityThreshold: 0.3,
      forwardOnly: true,
    },
  };

  assert(
    typeof data.breed!.mother === "object",
    "breed.mother should be an object, not a string",
  );
  assert(
    typeof data.breed!.father === "object",
    "breed.father should be an object, not a string",
  );

  const cloned = structuredClone(data);
  assertEquals(
    cloned.breed!.mother.input,
    motherJson.input,
    "cloned mother should preserve input count",
  );

  mother.dispose();
  father.dispose();
});

Deno.test("RequestData discover carries CreatureExport object, not string", () => {
  const creature = createTestCreature();
  const json: CreatureExport = creature.exportJSON();

  const data: RequestData = {
    taskID: 4,
    discover: {
      creature: json,
      config: {
        costName: "MSE",
        populationSize: 10,
      } as RequestData["discover"] extends { config: infer C } ? C : never,
    },
  };

  assert(
    typeof data.discover!.creature === "object",
    "discover.creature should be an object, not a string",
  );

  creature.dispose();
});

Deno.test("ResponseData train carries CreatureExport objects, not strings", () => {
  const creature = createTestCreature();
  const json: CreatureExport = creature.exportJSON();
  // CreatureTrace extends CreatureExport with trace-specific synapse/neuron data
  const traceJson = json as unknown as CreatureTrace;

  const response: ResponseData = {
    taskID: 1,
    duration: 100,
    train: {
      ID: "test-train-1",
      creature: json,
      error: 0.05,
      trace: traceJson,
    },
  };

  assert(
    typeof response.train!.creature === "object",
    "train.creature should be an object, not a string",
  );
  assert(
    typeof response.train!.trace === "object",
    "train.trace should be an object, not a string",
  );

  const cloned = structuredClone(response);
  assertEquals(
    cloned.train!.creature.input,
    json.input,
    "cloned response creature should preserve input count",
  );

  creature.dispose();
});

Deno.test("ResponseData breed carries CreatureExport object, not string", () => {
  const creature = createTestCreature();
  const json: CreatureExport = creature.exportJSON();

  const response: ResponseData = {
    taskID: 1,
    duration: 50,
    breed: {
      offspring: json,
      success: true,
    },
  };

  assert(
    typeof response.breed!.offspring === "object",
    "breed.offspring should be an object, not a string",
  );

  const cloned = structuredClone(response);
  assertExists(
    cloned.breed!.offspring,
    "cloned response should have offspring",
  );
  assertEquals(
    cloned.breed!.offspring!.neurons.length,
    json.neurons.length,
    "cloned offspring should preserve neuron count",
  );

  creature.dispose();
});

Deno.test("structured clone creates deep copy preventing shared reference mutation", () => {
  const creature = createTestCreature();
  const json: CreatureExport = creature.exportJSON();

  const data: RequestData = {
    taskID: 1,
    evaluate: {
      creature: json,
      feedbackLoop: false,
    },
  };

  // Structured clone should create independent copies
  const cloned = structuredClone(data);

  // Mutating the clone should not affect the original
  cloned.evaluate!.creature.neurons[0].bias = 999;
  assert(
    data.evaluate!.creature.neurons[0].bias !== 999,
    "mutating clone should not affect original (deep copy via structuredClone)",
  );

  creature.dispose();
});

Deno.test("GC cleanup uses null instead of empty string for object fields", () => {
  const creature = createTestCreature();
  const json: CreatureExport = creature.exportJSON();
  const traceJson = json as unknown as CreatureTrace;

  const response: ResponseData = {
    taskID: 1,
    duration: 100,
    train: {
      ID: "test",
      creature: json,
      error: 0.05,
      trace: traceJson,
      compact: json,
      backtracked: json,
      forward: json,
    },
  };

  // Simulate GC cleanup pattern used in ProcessCompletedResults.ts
  clearForGc(response.train!, "creature");
  clearForGc(response.train!, "trace");
  clearForGc(response.train!, "compact");
  clearForGc(response.train!, "backtracked");
  clearForGc(response.train!, "forward");

  // Verify fields are null (not empty string)
  // deno-lint-ignore no-explicit-any
  const train = response.train as any;
  assertEquals(train.creature, null, "creature should be null after GC");
  assertEquals(train.trace, null, "trace should be null after GC");

  creature.dispose();
});

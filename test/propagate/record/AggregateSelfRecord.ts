/**
 * Issue #3389: Aggregate-squash neurons (MAXIMUM/MINIMUM/IF) delegate the
 * error-attribution walk to their selected input path. Before this fix they
 * never wrote their own pre-activation `value` or attributed `errors`, so
 * exports showed a fully-null `value` series for every aggregate neuron —
 * including `output-0` itself.
 *
 * These tests assert the recorded quantities are the ones the `record()`
 * implementations already compute internally: `toValue(neuron, activation)`.
 */
import { assert, assertAlmostEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { IF } from "@methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "@methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "@methods/activations/aggregate/MINIMUM.ts";
import { toValue } from "@propagate/BackPropagation.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

function activateAndRecord(
  creatureJSON: CreatureExport,
  input: number[],
  expected: number[],
) {
  const creature = Creature.fromJSON(creatureJSON);
  const config = createBackPropagationConfig({
    sparseRatio: 1,
    disableRandomSamples: true,
    generations: 0,
  });
  const sparseConfig = new SparseConfig(creature.exportJSON(), config);
  creature.activateAndTrace(new Float32Array(input), false, sparseConfig);

  const discoverMap = creature.record(new Float32Array(expected));
  return { creature, discoverMap };
}

function neuronByUUID(creature: Creature, uuid: string) {
  const neuron = creature.neurons.find((n) => n.uuid === uuid);
  assert(neuron, `Expected neuron ${uuid}`);
  return neuron;
}

/** Two hidden IDENTITY feeds into a single aggregate output neuron. */
function aggregateOutputJSON(squash: string): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-a", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "hidden-b", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 1 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 1 },
    ],
  };
}

Deno.test("record(MAXIMUM): records the aggregate neuron's own value and errors", () => {
  const { creature, discoverMap } = activateAndRecord(
    aggregateOutputJSON(MAXIMUM.NAME),
    [1, 0.5],
    [0],
  );

  const output = neuronByUUID(creature, "output-0");
  const record = discoverMap.get(output.id);
  assert(record, "Expected a record entry for output-0");

  const currentValue = toValue(output, record.activation);
  assert(
    typeof record.value === "number" && Number.isFinite(record.value),
    `Expected a finite recorded value, got ${record.value}`,
  );
  assertAlmostEquals(record.value, currentValue, 1e-6);

  assert(
    record.errors.length > 0,
    "Expected at least one attributed error for output-0",
  );
  assertAlmostEquals(record.errors[0], toValue(output, 0) - currentValue, 1e-6);
});

Deno.test("record(MINIMUM): records the aggregate neuron's own value and errors", () => {
  const { creature, discoverMap } = activateAndRecord(
    aggregateOutputJSON(MINIMUM.NAME),
    [1, 0.5],
    [0],
  );

  const output = neuronByUUID(creature, "output-0");
  const record = discoverMap.get(output.id);
  assert(record, "Expected a record entry for output-0");

  const currentValue = toValue(output, record.activation);
  assert(
    typeof record.value === "number" && Number.isFinite(record.value),
    `Expected a finite recorded value, got ${record.value}`,
  );
  assertAlmostEquals(record.value, currentValue, 1e-6);

  assert(
    record.errors.length > 0,
    "Expected at least one attributed error for output-0",
  );
  assertAlmostEquals(record.errors[0], toValue(output, 0) - currentValue, 1e-6);
});

Deno.test("record(IF): records the aggregate neuron's own value and errors", () => {
  const creatureJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-a", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "hidden-b", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IF.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 1 },
      {
        fromUUID: "input-1",
        toUUID: "output-0",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "hidden-a",
        toUUID: "output-0",
        weight: 1,
        type: "positive",
      },
      {
        fromUUID: "hidden-b",
        toUUID: "output-0",
        weight: 1,
        type: "negative",
      },
    ],
  };

  const { creature, discoverMap } = activateAndRecord(creatureJSON, [1, 1], [
    0,
  ]);

  const output = neuronByUUID(creature, "output-0");
  const record = discoverMap.get(output.id);
  assert(record, "Expected a record entry for output-0");

  const currentValue = toValue(output, record.activation);
  assert(
    typeof record.value === "number" && Number.isFinite(record.value),
    `Expected a finite recorded value, got ${record.value}`,
  );
  assertAlmostEquals(record.value, currentValue, 1e-6);

  assert(
    record.errors.length > 0,
    "Expected at least one attributed error for output-0",
  );
  assertAlmostEquals(record.errors[0], toValue(output, 0) - currentValue, 1e-6);
});

Deno.test("record(MAXIMUM): records own value even when no upstream path is eligible", () => {
  // Every inbound link comes straight from an input neuron, so MAXIMUM.record
  // finds no neuron to delegate to and returns early. The aggregate's own
  // value/errors must still be recorded.
  const creatureJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "output-0", type: "output", squash: MAXIMUM.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 1 },
    ],
  };

  const { creature, discoverMap } = activateAndRecord(creatureJSON, [1, 0.5], [
    0,
  ]);

  const output = neuronByUUID(creature, "output-0");
  const record = discoverMap.get(output.id);
  assert(record, "Expected a record entry for output-0");

  assert(
    typeof record.value === "number" && Number.isFinite(record.value),
    `Expected a finite recorded value, got ${record.value}`,
  );
  assert(
    record.errors.length > 0,
    "Expected at least one attributed error for output-0",
  );
});

Deno.test("record(IF): records own value even when no eligible branch exists", () => {
  // Condition is positive but there is no positive branch, so IF.record has no
  // eligible links and returns early — self-recording must still happen.
  const creatureJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-b", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IF.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 1 },
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "hidden-b",
        toUUID: "output-0",
        weight: 1,
        type: "negative",
      },
    ],
  };

  const { creature, discoverMap } = activateAndRecord(creatureJSON, [1, 1], [
    0,
  ]);

  const output = neuronByUUID(creature, "output-0");
  const record = discoverMap.get(output.id);
  assert(record, "Expected a record entry for output-0");

  assert(
    typeof record.value === "number" && Number.isFinite(record.value),
    `Expected a finite recorded value, got ${record.value}`,
  );
  assert(
    record.errors.length > 0,
    "Expected at least one attributed error for output-0",
  );
});

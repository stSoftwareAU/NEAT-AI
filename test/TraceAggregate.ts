import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { createBackPropagationConfig } from "../src/architecture/BackPropagation.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("TraceAggregateMINIMUM", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
      { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
      { bias: 0.3, type: "hidden", squash: "MINIMUM", index: 4 },
      { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
      { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
    ],
    synapses: [
      { weight: 0.1, from: 0, to: 2 },
      { weight: -0.2, from: 1, to: 3 },
      { weight: 0.3, from: 2, to: 4 },
      { weight: -0.4, from: 3, to: 4 },
      { weight: -0.5, from: 4, to: 5 },
      { weight: 0.6, from: 4, to: 6 },
    ],
    input: 2,
    output: 2,
  };
  const network = Creature.fromJSON(json);
  network.validate();
  Deno.writeTextFileSync(
    "test/data/.a.json",
    JSON.stringify(network.exportJSON(), null, 2),
  );
  const input = [0.1, 0.2];
  network.activate(input);

  const aOut = network.activateAndTrace(input);

  const changed = network.applyLearnings(
    createBackPropagationConfig({ trainingMutationRate: 1 }),
  );

  assert(changed, "should have changed");

  const dOut = network.activate(input);

  Deno.writeTextFileSync(
    "test/data/.d.json",
    JSON.stringify(network.exportJSON(), null, 2),
  );
  assertAlmostEquals(aOut[0], dOut[0], 0.0001);

  assertAlmostEquals(aOut[1], dOut[1], 0.0001);
});

Deno.test("TraceAggregateMAXIMUM", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
      { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
      { bias: 0.3, type: "hidden", squash: "MAXIMUM", index: 4 },
      { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
      { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
    ],
    synapses: [
      { weight: 0.1, from: 0, to: 2 },
      { weight: -0.2, from: 1, to: 3 },
      { weight: 0.3, from: 2, to: 4 },
      { weight: -0.4, from: 3, to: 4 },
      { weight: -0.5, from: 4, to: 5 },
      { weight: 0.6, from: 4, to: 6 },
    ],
    input: 2,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  Deno.writeTextFileSync(
    "test/data/.A.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  const input = [0.1, 0.2];
  creature.activate(input);

  const aOut = creature.activateAndTrace(input);

  const changed = creature.applyLearnings(
    createBackPropagationConfig({ trainingMutationRate: 1 }),
  );

  assert(changed, "should have changed");

  const dOut = creature.activate(input);

  Deno.writeTextFileSync(
    "test/data/.B.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  assertAlmostEquals(aOut[0], dOut[0], 0.0001);

  assertAlmostEquals(aOut[1], dOut[1], 0.0001);
});

Deno.test("TraceAggregateIF", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
      { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
      { bias: 0.3, type: "hidden", squash: "IF", index: 4 },
      { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
      { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
    ],
    synapses: [
      { weight: 0.1, from: 0, to: 2 },
      { weight: -0.2, from: 1, to: 3 },
      { weight: 0.15, from: 1, to: 4, type: "condition" },
      { weight: 0.3, from: 2, to: 4, type: "positive" },
      { weight: -0.4, from: 3, to: 4, type: "negative" },
      { weight: -0.5, from: 4, to: 5 },
      { weight: 0.6, from: 4, to: 6 },
    ],
    input: 2,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();
  Deno.writeTextFileSync(
    "test/data/.a.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  const input = [0.1, 0.2];
  creature.activate(input);
  const aOut = creature.activateAndTrace(input);

  const changed = creature.applyLearnings(
    createBackPropagationConfig({ trainingMutationRate: 1 }),
  );

  assert(changed, "should have changed");

  const dOut = creature.activate(input);

  Deno.writeTextFileSync(
    "test/data/.d.json",
    JSON.stringify(creature.exportJSON(), null, 2),
  );
  assertAlmostEquals(aOut[0], dOut[0], 0.0001);

  assertAlmostEquals(aOut[1], dOut[1], 0.0001);
});

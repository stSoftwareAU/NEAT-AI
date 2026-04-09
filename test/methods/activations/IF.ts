import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("IF - positive condition selects positive branch", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "IF", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 3, type: "condition" },
      { weight: 1, from: 1, to: 3, type: "positive" },
      { weight: 1, from: 2, to: 3, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  // Condition > 0, so positive branch (input[1]) should be selected
  const data = new Float32Array([1.0, 5.0, -3.0]);
  const actual = creature.activateAndTrace(data, false, sparseConfig)[0];
  assertAlmostEquals(actual, 5.0, 0.001, "positive branch should be selected");
});

Deno.test("IF - negative condition selects negative branch", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "IF", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 3, type: "condition" },
      { weight: 1, from: 1, to: 3, type: "positive" },
      { weight: 1, from: 2, to: 3, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  // Condition <= 0, so negative branch (input[2]) should be selected
  const data = new Float32Array([-1.0, 5.0, -3.0]);
  const actual = creature.activateAndTrace(data, false, sparseConfig)[0];
  assertAlmostEquals(actual, -3.0, 0.001, "negative branch should be selected");
});

Deno.test("IF - repeated calls return consistent results", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "IF", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 3, type: "condition" },
      { weight: 1, from: 1, to: 3, type: "positive" },
      { weight: 1, from: 2, to: 3, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  for (let p = 0; p < 100; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const c = Math.random() * 2 - 1;
    const data = new Float32Array([a, b, c]);
    const actual = creature.activateAndTrace(data, false, sparseConfig)[0];
    const actual2 = creature.activateAndTrace(data, false, sparseConfig)[0];
    assert(
      Math.abs(actual - actual2) < 0.00000001,
      "repeated calls should return the same result",
    );
  }
});

Deno.test("IF - condition at zero selects negative branch", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "IF", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 3, type: "condition" },
      { weight: 1, from: 1, to: 3, type: "positive" },
      { weight: 1, from: 2, to: 3, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );

  // Condition = 0, so negative branch should be selected (condition > 0 is false)
  const data = new Float32Array([0, 7.0, 2.0]);
  const actual = creature.activateAndTrace(data, false, sparseConfig)[0];
  assertAlmostEquals(
    actual,
    2.0,
    0.001,
    "condition=0 should select negative branch",
  );
});

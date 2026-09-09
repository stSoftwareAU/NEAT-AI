import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import { SubConnection } from "@mutate/SubConnection.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("if-bias", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", index: 0 },
      { type: "input", index: 1 },
      { type: "input", index: 2 },
      { type: "hidden", squash: "IDENTITY", bias: -0.5, index: 3 },
      {
        type: "output",
        squash: "IF",
        index: 4,
        bias: 0,
      },
    ],
    synapses: [
      { from: 1, to: 3, weight: 1 },
      { from: 2, to: 4, weight: 1, type: "positive" },
      { from: 3, to: 4, weight: 1, type: "condition" },
      { from: 0, to: 4, weight: 1, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const sparseConfig = new SparseConfig(
    creature.exportJSON(),
    createBackPropagationConfig({}),
  );
  const tmpJSON = JSON.stringify(creature.exportJSON(), null, 1);

  console.log(tmpJSON);

  const input1 = new Float32Array([-1, 0.4, 1]);

  const r1 = creature.activateAndTrace(input1, false, sparseConfig)[0];

  assertAlmostEquals(r1, -1, 0.0001, "should handle bias");

  const input2 = new Float32Array([-1, 0.6, 1]);

  const r2 = creature.activateAndTrace(input2, false, sparseConfig)[0];

  assertAlmostEquals(r2, 1, 0.0001, "should handle bias");
});

Deno.test("if/Else", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "input", squash: "LOGISTIC", index: 2 },
      {
        type: "output",
        squash: "IF",
        index: 3,
        bias: 0,
      },
    ],
    synapses: [
      { from: 2, to: 3, weight: 1, type: "positive" },
      { from: 1, to: 3, weight: 1, type: "condition" },
      { from: 0, to: 3, weight: 1, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const network1 = Creature.fromJSON(json);
  const tmpJSON = JSON.stringify(network1.exportJSON(), null, 1);

  console.log(tmpJSON);
  const creature2 = Creature.fromJSON(JSON.parse(tmpJSON));
  const sparseConfig = new SparseConfig(
    creature2.exportJSON(),
    createBackPropagationConfig({}),
  );
  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const flag = Math.random() > 0.5 ? 1 : 0;

    const expected = flag > 0 ? b : a;

    const actual = creature2.activateAndTrace(
      new Float32Array([a, flag, b]),
      false,
      sparseConfig,
    )[0];

    const diff = Math.abs(expected - actual);
    assert(diff < 0.00001, p + ") If/Else didn't work " + diff);
  }
});

Deno.test("if-fix", () => {
  const json: CreatureInternal = {
    neurons: [
      { type: "input", squash: "LOGISTIC", index: 0 },
      { type: "input", squash: "LOGISTIC", index: 1 },
      { type: "input", squash: "LOGISTIC", index: 2 },
      { type: "input", squash: "LOGISTIC", index: 3 },
      { type: "input", squash: "LOGISTIC", index: 4 },
      {
        type: "output",
        squash: "IF",
        index: 5,
        bias: 0,
      },
    ],
    synapses: [
      { from: 2, to: 5, weight: 1, type: "positive" },
      { from: 1, to: 5, weight: 1, type: "condition" },
      { from: 4, to: 5, weight: 1, type: "negative" },
    ],
    input: 5,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const subConnection = new SubConnection(creature);
  for (let i = 0; i < 10; i++) {
    subConnection.mutate();
  }

  const addConnection = new AddConnection(creature);
  for (let i = 0; i < 10; i++) {
    addConnection.mutate();
  }

  for (let i = 0; i < 100; i++) {
    subConnection.mutate();
  }
  creature.fix();
  const creature2 = Creature.fromJSON(creature.exportJSON());
  creature2.validate();

  // Issue #3976: `SubConnection` now removes a synapse through NEAT-AI-core's
  // `prune_synapse`, which **rewrites** an `IF` the removal left short a role
  // instead of refusing that removal outright the way the superseded
  // TypeScript `#wouldBreakIfNeuron` did. An `IF` whose condition goes is
  // flattened — exactly, computing the same number on every record — to the
  // branch that condition always took, so this fixture's output may
  // legitimately finish as an `IDENTITY` carrying fewer inward edges. That is
  // the deliberate improvement the migration bought: typed `IF` structure is
  // reachable to the mutation operators at last.
  //
  // The invariant this test was really guarding is unchanged and is asserted
  // below: after all that churn plus `fix()`, no *surviving* `IF` is ever left
  // short a role.
  const outputNeuron = creature.neurons[5];
  const toList = creature.inwardConnections(5);

  if (outputNeuron.squash === "IF") {
    const roles = new Set(
      toList.map((synapse) => synapse.type ?? "positive"),
    );
    assert(
      roles.size === 3,
      "A surviving IF must keep all three roles, had: " +
        [...roles].join(", "),
    );
    assert(
      toList.length > 2,
      "Should have 3 connections was: " + toList.length,
    );
  } else {
    // Flattening to the branch the condition always took is the *only* rewrite
    // that may retire an `IF`, so naming the squash it must land on keeps this
    // arm a real assertion rather than one that passes because no `IF` is left.
    assertEquals(
      outputNeuron.squash,
      "IDENTITY",
      "an IF may only be retired by being flattened to the branch it took",
    );
    for (const neuron of creature.neurons) {
      if (neuron.squash !== "IF") continue;
      const roles = new Set(
        creature.inwardConnections(neuron.index).map((synapse) =>
          synapse.type ?? "positive"
        ),
      );
      assertEquals(
        roles.size,
        3,
        "Every surviving IF must carry a condition, a positive and a negative",
      );
    }
  }
});

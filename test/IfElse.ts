import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";

import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { AddConnection } from "../src/mutate/AddConnection.ts";
import { SubConnection } from "../src/mutate/SubConnection.ts";

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
  const network = Creature.fromJSON(json);
  const tmpJSON = JSON.stringify(network.exportJSON(), null, 2);

  console.log(tmpJSON);

  const input1 = [-1, 0.4, 1];

  const r1 = network.activateAndTrace(input1)[0];

  assertAlmostEquals(r1, -1, 0.0001, "should handle bias");

  const input2 = [-1, 0.6, 1];

  const r2 = network.activateAndTrace(input2)[0];

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
  const tmpJSON = JSON.stringify(network1.exportJSON(), null, 2);

  console.log(tmpJSON);
  const network2 = Creature.fromJSON(JSON.parse(tmpJSON));

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const flag = Math.random() > 0.5 ? 1 : 0;

    const expected = flag > 0 ? b : a;

    const actual = network2.activateAndTrace([a, flag, b])[0];

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

  const toList = creature.inwardConnections(5);

  assert(toList.length > 2, "Should have 3 connections was: " + toList.length);
});

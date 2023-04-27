import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";

import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("if-bias", () => {
  const json: NetworkInternal = {
    nodes: [
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
    connections: [
      { from: 1, to: 3, weight: 1 },
      { from: 2, to: 4, weight: 1, type: "positive" },
      { from: 3, to: 4, weight: 1, type: "condition" },
      { from: 0, to: 4, weight: 1, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const network = Network.fromJSON(json);
  const tmpJSON = JSON.stringify(network.exportJSON(), null, 2);

  console.log(tmpJSON);

  const input1 = [-1, 0.4, 1];

  const r1 = network.activate(input1)[0];

  assertAlmostEquals(r1, -1, 0.0001, "should handle bias");

  const input2 = [-1, 0.6, 1];

  const r2 = network.activate(input2)[0];

  assertAlmostEquals(r2, 1, 0.0001, "should handle bias");
});

Deno.test("if/Else", () => {
  const json: NetworkInternal = {
    nodes: [
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
    connections: [
      { from: 2, to: 3, weight: 1, type: "positive" },
      { from: 1, to: 3, weight: 1, type: "condition" },
      { from: 0, to: 3, weight: 1, type: "negative" },
    ],
    input: 3,
    output: 1,
  };
  const network1 = Network.fromJSON(json);
  const tmpJSON = JSON.stringify(network1.exportJSON(), null, 2);

  console.log(tmpJSON);
  const network2 = Network.fromJSON(JSON.parse(tmpJSON));

  for (let p = 0; p < 1000; p++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    const flag = Math.random() > 0.5 ? 1 : 0;

    const expected = flag > 0 ? b : a;

    const actual = network2.activate([a, flag, b])[0];

    const diff = Math.abs(expected - actual);
    assert(diff < 0.00001, p + ") If/Else didn't work " + diff);
  }
});

Deno.test("if-fix", () => {
  const json: NetworkInternal = {
    nodes: [
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
    connections: [
      { from: 2, to: 5, weight: 1, type: "positive" },
      { from: 1, to: 5, weight: 1, type: "condition" },
      { from: 4, to: 5, weight: 1, type: "negative" },
    ],
    input: 5,
    output: 1,
  };
  const network = Network.fromJSON(json);

  for (let i = 0; i < 10; i++) {
    network.subConnection();
  }

  for (let i = 0; i < 10; i++) {
    network.addConnection();
  }

  for (let i = 0; i < 100; i++) {
    network.subConnection();
  }
  network.fix();
  const network2 = Network.fromJSON(network.exportJSON());
  network2.validate();
  console.info(JSON.stringify(network2.exportJSON(), null, 2));
  const toList = network.toConnections(5);

  assert(toList.length > 2, "Should have 3 connections was: " + toList.length);
});

import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.198.0/assert/mod.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("TraceAggregateMINIMUM", () => {
  const json: NetworkInternal = {
    nodes: [
      { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
      { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
      { bias: 0.3, type: "hidden", squash: "MINIMUM", index: 4 },
      { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
      { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
    ],
    connections: [
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
  const network = Network.fromJSON(json);
  network.validate();
  Deno.writeTextFileSync(
    "test/data/.a.json",
    JSON.stringify(network.exportJSON(), null, 2),
  );
  const input = [0.1, 0.2];
  const eOut = network.noTraceActivate(input);
  console.info(
    "PRE",
    "output",
    eOut,
  );
  const aOut = network.activate(input);

  console.info(
    "START",
    "output",
    aOut,
  );
  // const bOut = network.noTraceActivate(input);

  // assertAlmostEquals(aOut[0], bOut[0], 0.0001);
  // assertAlmostEquals(aOut[1], bOut[1], 0.0001);

  // network.fix();
  // const cOut = network.noTraceActivate(input);

  // assertAlmostEquals(aOut[0], cOut[0], 0.0001);
  // assertAlmostEquals(aOut[1], cOut[1], 0.0001);

  const changed = network.applyLearnings();

  assert(changed, "should have changed");

  const dOut = network.noTraceActivate(input);

  console.info(
    "END",
    "output",
    dOut,
  );
  Deno.writeTextFileSync(
    "test/data/.d.json",
    JSON.stringify(network.exportJSON(), null, 2),
  );
  assertAlmostEquals(aOut[0], dOut[0], 0.0001);

  assertAlmostEquals(aOut[1], dOut[1], 0.0001);
});

Deno.test("TraceAggregateMAXIMUM", () => {
  const json: NetworkInternal = {
    nodes: [
      { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
      { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
      { bias: 0.3, type: "hidden", squash: "MAXIMUM", index: 4 },
      { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
      { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
    ],
    connections: [
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
  const network = Network.fromJSON(json);
  network.validate();
  Deno.writeTextFileSync(
    "test/data/.a.json",
    JSON.stringify(network.exportJSON(), null, 2),
  );
  const input = [0.1, 0.2];
  const eOut = network.noTraceActivate(input);
  console.info(
    "PRE",
    "output",
    eOut,
  );
  const aOut = network.activate(input);

  console.info(
    "START",
    "output",
    aOut,
  );

  const changed = network.applyLearnings();

  assert(changed, "should have changed");

  const dOut = network.noTraceActivate(input);

  console.info(
    "END",
    "output",
    dOut,
  );
  Deno.writeTextFileSync(
    "test/data/.d.json",
    JSON.stringify(network.exportJSON(), null, 2),
  );
  assertAlmostEquals(aOut[0], dOut[0], 0.0001);

  assertAlmostEquals(aOut[1], dOut[1], 0.0001);
});

Deno.test("TraceAggregateIF", () => {
  const json: NetworkInternal = {
    nodes: [
      { bias: 0.1, type: "hidden", squash: "LOGISTIC", index: 2 },
      { bias: -0.2, type: "hidden", squash: "LOGISTIC", index: 3 },
      { bias: 0.3, type: "hidden", squash: "IF", index: 4 },
      { bias: -0.4, type: "output", squash: "LOGISTIC", index: 5 },
      { bias: 0.5, type: "output", squash: "LOGISTIC", index: 6 },
    ],
    connections: [
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
  const network = Network.fromJSON(json);
  network.validate();
  Deno.writeTextFileSync(
    "test/data/.a.json",
    JSON.stringify(network.exportJSON(), null, 2),
  );
  const input = [0.1, 0.2];
  const eOut = network.noTraceActivate(input);
  console.info(
    "PRE",
    "output",
    eOut,
  );
  const aOut = network.activate(input);

  console.info(
    "START",
    "output",
    aOut,
  );

  const changed = network.applyLearnings();

  assert(changed, "should have changed");

  const dOut = network.noTraceActivate(input);

  console.info(
    "END",
    "output",
    dOut,
  );
  Deno.writeTextFileSync(
    "test/data/.d.json",
    JSON.stringify(network.exportJSON(), null, 2),
  );
  assertAlmostEquals(aOut[0], dOut[0], 0.0001);

  assertAlmostEquals(aOut[1], dOut[1], 0.0001);
});

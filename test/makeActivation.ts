import {
  assertAlmostEquals,
} from "https://deno.land/std@0.185.0/testing/asserts.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkState } from "../src/architecture/NetworkState.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("makeActivation", () => {
  const creature = Network.fromJSON({
    "nodes": [{
      "bias": 0,
      "type": "hidden",
      "squash": "LOGISTIC",
      "index": 2,
    }, {
      "bias": 0,
      "type": "hidden",
      "squash": "LOGISTIC",
      "index": 3,
    }, {
      "bias": -0.49135010426905,
      "type": "output",
      "squash": "BIPOLAR_SIGMOID",
      "index": 4,
    }],
    "connections": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
    }, {
      "weight": -0.067,
      "from": 2,
      "to": 3,
    }, { "weight": 0.96864643541, "from": 3, "to": 4 }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "error", value: "0.5" },
    ],
  });

  creature.validate();
  const ns = new NetworkState(creature);

  ns.makeActivation([-0.1, -0.2], false);

  console.info(ns.activations);
  assertAlmostEquals(ns.activations[0], -0.1, 0.0000001);
  assertAlmostEquals(ns.activations[1], -0.2, 0.0000001);
  assertAlmostEquals(ns.activations[2], 0, 0.0000001);
  assertAlmostEquals(ns.activations[3], 0, 0.0000001);
  assertAlmostEquals(ns.activations[4], 0, 0.0000001);

  ns.activations[2] = 0.1;
  ns.activations[3] = 0.2;
  ns.activations[4] = 0.3;
  ns.makeActivation([-0.3, -0.4], true);

  console.info(ns.activations);

  assertAlmostEquals(ns.activations[0], -0.3, 0.0000001);
  assertAlmostEquals(ns.activations[1], -0.4, 0.0000001);
  assertAlmostEquals(ns.activations[2], 0.1, 0.0000001);
  assertAlmostEquals(ns.activations[3], 0.2, 0.0000001);
  assertAlmostEquals(ns.activations[4], 0.3, 0.0000001);

  ns.makeActivation([-0.5, -0.6], false);

  console.info(ns.activations);
  assertAlmostEquals(ns.activations[0], -0.5, 0.0000001);
  assertAlmostEquals(ns.activations[1], -0.6, 0.0000001);
  assertAlmostEquals(ns.activations[2], 0, 0.0000001);
  assertAlmostEquals(ns.activations[3], 0, 0.0000001);
  assertAlmostEquals(ns.activations[4], 0, 0.0000001);
});

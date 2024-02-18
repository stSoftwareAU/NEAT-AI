import {
  assert,
  assertAlmostEquals,
} from "https://deno.land/std@0.216.0/assert/mod.ts";
import { Creature } from "../src/Creature.ts";

import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("No squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0.5, type: "constant", index: 1 },
      { bias: 0, type: "output", squash: "IDENTITY", index: 2 },
    ],
    synapses: [
      { weight: 1, from: 1, to: 2 },
    ],
    input: 1,
    output: 1,
  };
  const network = Creature.fromJSON(json);
  network.validate();
  network.fix();
  network.validate();

  const value = network.activate([Math.random()])[0];

  assertAlmostEquals(value, 0.5, 0.00001);

  const value2 = network.activateAndTrace([Math.random()])[0];

  assertAlmostEquals(value2, 0.5, 0.00001);
});

Deno.test("Constants", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0.5, type: "constant", index: 1 },
      { bias: 0.6, type: "hidden", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "MAXIMUM", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 2 },
      { weight: 1, from: 1, to: 3 },
      { weight: 1, from: 2, to: 3 },
    ],
    input: 1,
    output: 1,
  };
  const network = Creature.fromJSON(json);
  network.validate();

  for (let i = 100; i--;) {
    network.modBias();
    network.addConnection();
  }

  network.validate();
  Creature.fromJSON(network.exportJSON());
  assert(
    Math.abs(network.neurons[1].bias ? network.neurons[1].bias : 0) - 0.5 <
      0.00001,
    "Should NOT have changed the constant node was: " + network.neurons[1].bias,
  );

  assert(
    (network.neurons[2].bias ? network.neurons[2].bias : 0) > 0.60001 ||
      (network.neurons[2].bias ? network.neurons[2].bias : 0) < 0.59999,
    "Should have changed the hidden node was: " + network.neurons[2].bias,
  );

  assert(
    network.toConnections(1).length === 0,
    "Should not have any inward connections",
  );
});

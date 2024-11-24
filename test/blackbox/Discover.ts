import { assert } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { discover } from "../../src/blackbox/Discover.ts";
import { Creature } from "../../src/Creature.ts";

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-3", squash: "Cosine", bias: 3 },
      { type: "hidden", uuid: "hidden-4", squash: "CLIPPED", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-3", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.3 },

      { fromUUID: "hidden-3", toUUID: "hidden-4", weight: -0.5 },
      { fromUUID: "hidden-4", toUUID: "output-0", weight: 0.6 },

      { fromUUID: "hidden-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

Deno.test("Discover-no-score", () => {
  const mum = makeCreature();
  delete mum.score;
  mum.neurons[3].bias = 3.1;
  const child = makeCreature();
  delete child.score;
  child.neurons[3].bias = 3.0;

  discover(mum, child);
  assert(child.memetic      === undefined);
});

Deno.test("Discover-score", () => {
  const mum = makeCreature();
  mum.score = -0.1;
  mum.neurons[3].bias = 3.1;
  const child = makeCreature();
  delete child.score;
  child.neurons[3].bias = 3.0;

  discover(mum, child);
  assert(child.memetic !== undefined);
});

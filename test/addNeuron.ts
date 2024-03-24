import { assert } from "https://deno.land/std@0.220.1/assert/mod.ts";
import { getTag } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../src/Creature.ts";
import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { creatureValidate } from "../src/architecture/CreatureValidate.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const json: CreatureInternal = {
  neurons: [
    {
      type: "input",
      squash: "LOGISTIC",
      index: 0,
    },
    {
      type: "input",
      squash: "LOGISTIC",
      index: 1,
    },
    {
      type: "input",
      squash: "LOGISTIC",
      index: 2,
    },
    {
      bias: 0,
      type: "hidden",
      squash: "TANH",
      index: 3,
      tags: [{
        name: "original",
        value: "yes",
      }],
    },
    {
      bias: 0,
      type: "output",
      squash: "IF",
      index: 4,
    },
  ],
  synapses: [
    {
      weight: 1,
      from: 2,
      to: 4,
      type: "positive",
    },
    {
      weight: 1,
      from: 1,
      to: 4,
      type: "condition",
    },
    {
      weight: 1,
      from: 0,
      to: 4,
      type: "negative",
    },
    {
      weight: 0.09059831121601714,
      from: 2,
      to: 3,
    },
    {
      weight: -0.05057706266658744,
      from: 3,
      to: 4,
    },
  ],
  input: 3,
  output: 1,
};

Deno.test("addNodeValidate", () => {
  for (let j = 10; j--;) {
    const creature = Creature.fromJSON(json);
    for (let i = 1000; i--;) {
      creature.addNeuron();
    }

    creatureValidate(creature);
  }
});

Deno.test("addNode", () => {
  const network = Creature.fromJSON(json);

  for (let i = 1000; i--;) {
    network.addNeuron();
  }

  const nodes = network.internalJSON().neurons;

  for (let pos = nodes.length; pos--;) {
    const node = nodes[pos];
    const indx = network.input + pos;
    const tag = getTag(node, "original");

    if (tag === "yes") {
      assert(
        indx > 3,
        "Unlikely to be the first node after randomly adding 1000 nodes was: " +
          indx,
      );
    }

    if (tag === "yes") {
      assert(
        indx < 1004,
        "Unlikely to be the last node after randomly adding 1000 nodes was: " +
          indx,
      );
    }

    const to = network.inwardConnections(indx);

    if (node.type !== "input") {
      assert(to.length >= 1, indx + ") expected at least 1 got " + to.length);
    } else {
      assert(
        to.length == 0,
        indx + ") 'input' should not have any 'to' connections was: " +
          to.length,
      );
    }

    const from = network.outwardConnections(indx);

    if (node.type !== "output") {
      assert(
        from.length >= 1,
        indx + ") expected at least 1 got " + from.length,
      );
    } else {
      assert(
        from.length == 0,
        indx + ") 'output' should not have any 'from' connections was: " +
          from.length,
      );
    }
  }
});

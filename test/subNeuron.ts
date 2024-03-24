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
      type: "output",
      squash: "IF",
      index: 3,
    },
  ],
  synapses: [
    {
      weight: 1,
      from: 0,
      to: 3,
      type: "negative",
    },
    {
      weight: 1,
      from: 1,
      to: 3,
      type: "condition",
    },
    {
      weight: 1,
      from: 2,
      to: 3,
      type: "positive",
    },
  ],
  input: 3,
  output: 1,
};

Deno.test("subNode", () => {
  const creature = Creature.fromJSON(json);
  creatureValidate(creature, { neurons: 4, connections: 3 });
  creature.subNeuron();
  creatureValidate(creature, { neurons: 4 });
  for (let i = 100; i--;) {
    creature.validate();
    creature.addNeuron();
  }

  creatureValidate(creature, { neurons: 104 });

  for (let i = 110; i--;) {
    creature.subNeuron();
  }
  creatureValidate(creature, { neurons: 4, connections: 3 });
});

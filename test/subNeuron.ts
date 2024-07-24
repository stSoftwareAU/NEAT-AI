import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { creatureValidate } from "../src/architecture/CreatureValidate.ts";
import { AddNeuron } from "../src/mutate/AddNeuron.ts";
import { SubNeuron } from "../src/mutate/SubNeuron.ts";

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
  const subNeuron = new SubNeuron(creature);
  subNeuron.mutate();
  creatureValidate(creature, { neurons: 4 });
  const addNeuron = new AddNeuron(creature);
  for (let i = 100; i--;) {
    creature.validate();
    addNeuron.mutate();
  }

  creatureValidate(creature, { neurons: 104 });

  for (let i = 110; i--;) {
    subNeuron.mutate();
  }
  creatureValidate(creature, { neurons: 4, connections: 3 });
});

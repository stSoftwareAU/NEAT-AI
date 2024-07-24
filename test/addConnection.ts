import { Creature } from "../src/Creature.ts";
import { creatureValidate } from "../src/architecture/CreatureValidate.ts";
import { AddConnection } from "../src/mutate/AddConnection.ts";
import { AddNeuron } from "../src/mutate/AddNeuron.ts";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("addConnection", () => {
  const creature = new Creature(2, 1);
  creatureValidate(creature);
  const addNeuron = new AddNeuron(creature);
  for (let i = 10; i--;) {
    addNeuron.mutate();
  }

  const addConnection = new AddConnection(creature);
  for (let i = 10; i--;) {
    addConnection.mutate();
  }

  creatureValidate(creature);
});

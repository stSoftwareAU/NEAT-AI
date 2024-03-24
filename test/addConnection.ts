import { Creature } from "../src/Creature.ts";
import { creatureValidate } from "../src/architecture/CreatureValidate.ts";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("addConnection", () => {
  const creature = new Creature(2, 1);
  creatureValidate(creature);
  for (let i = 10; i--;) {
    creature.addNeuron();
  }

  for (let i = 10; i--;) {
    creature.addConnection();
  }

  creatureValidate(creature);
});

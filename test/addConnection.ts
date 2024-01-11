import { Creature } from "../src/Creature.ts";
((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("addConnection", () => {
  const network = new Creature(2, 1);
  network.validate();
  for (let i = 10; i--;) {
    network.addNode();
  }

  for (let i = 10; i--;) {
    network.addConnection();
  }

  network.validate();
});

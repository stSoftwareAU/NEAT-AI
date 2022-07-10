import { Network } from "../../NEAT-TS/src/architecture/network.js";

Deno.test("addConnection", () => {
  const network = new Network(2, 1);
  network.util.validate();
  for (let i = 10; i--;) {
    network.util.addNode();
  }

  for (let i = 10; i--;) {
    network.util.addConnection();
  }

  network.util.validate();
});

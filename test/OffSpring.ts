import { Neat } from "../src/Neat.ts";
import { NetworkUtil } from "../src/architecture/NetworkUtil.ts";
import { Network } from "../src/architecture/Network.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("OffSpring", async () => {
  const creature = NetworkUtil.fromJSON({
    "nodes": [{
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 0,
    }, {
      "bias": 0,
      "type": "input",
      "squash": "LOGISTIC",
      "index": 1,
    }, {
      "bias": -0.49135010426905,
      "type": "output",
      "squash": "BIPOLAR_SIGMOID",
      "index": 2,
    }],
    "connections": [{
      "weight": 0.9967556172986067,
      "from": 1,
      "to": 2,
    }, { "weight": 0.96864643541, "from": 0, "to": 2 }],
    "input": 2,
    "output": 1,
    tags: [
      { name: "error", value: "0.5" },
    ],
  });

  const neat = new Neat(1, 1, {}, []);

  await neat.populatePopulation(creature);
  for (let i = 0; i < neat.config.popSize; i++) {
    const kid = neat.getOffspring();
    await neat.populatePopulation(kid as Network);
  }
});

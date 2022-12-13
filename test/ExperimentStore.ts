import { Neat } from "../src/Neat.ts";
import { NetworkInterface } from "../src/architecture/NetworkInterface.ts";
import { assert } from "https://deno.land/std@0.167.0/testing/asserts.ts";
import { addTag } from "../src/tags/TagsInterface.ts";
import { Network } from "../src/architecture/Network.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("previous", async () => {
  const creature: NetworkInterface = Network.fromJSON({
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

  creature.score = 0.1234;

  const neat = new Neat(1, 1, { experimentStore: ".testExperiments" }, []);

  const p = [creature];
  neat.writeScores(p);

  const flag = await previousExperiment(creature, neat);

  assert(flag, "should have detected itself just written");

  delete creature.score;
  const flag2 = await previousExperiment(creature, neat);

  assert(flag2, "Don't look at score");

  addTag(creature, "hello", "world");

  const flag3 = await previousExperiment(creature, neat);

  assert(flag3, "Don't care about tags");
});

async function previousExperiment(creature: NetworkInterface, neat: Neat) {
  const key = await neat.makeUniqueName(creature);

  return neat.previousExperiment(key);
}

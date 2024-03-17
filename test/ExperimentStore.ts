import { assert } from "https://deno.land/std@0.220.1/assert/mod.ts";
import { addTag } from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../src/Creature.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import { Neat } from "../src/architecture/Neat.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("previous", async () => {
  const creature = Creature.fromJSON({
    "neurons": [{
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
    "synapses": [{
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

  const p = [Creature.fromJSON(creature)];
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

async function previousExperiment(creature: Creature, neat: Neat) {
  const key = await CreatureUtil.makeUUID(creature);

  return neat.previousExperiment(key);
}

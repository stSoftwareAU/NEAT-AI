import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import { Breed } from "@breed/Breed.ts";
import { Creature } from "@creature";
import { Genus } from "@neat/Genus.ts";
import { Mutator } from "@neat/Mutator.ts";
import { Neat } from "@neat/Neat.ts";

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
  // Issue #2275: writeScores is now async
  await neat.writeScores(p);

  const flag = previousExperiment(creature, neat);

  assert(flag, "should have detected itself just written");

  delete creature.score;
  const flag2 = previousExperiment(creature, neat);

  assert(flag2, "Don't look at score");

  addTag(creature, "hello", "world");

  const flag3 = previousExperiment(creature, neat);

  assert(flag3, "Don't care about tags");
});

function previousExperiment(creature: Creature, neat: Neat) {
  const key = CreatureUtil.makeUUID(creature);

  const mutator = new Mutator(neat.config);
  const genus = new Genus();

  const breed = new Breed(genus, neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  return deDuplicator.previousExperiment(key);
}

import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags";
import { Creature } from "../src/Creature.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import { Neat } from "../src/NEAT/Neat.ts";
import { DeDuplicator } from "../src/architecture/DeDuplicator.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Breed } from "../src/breed/Breed.ts";
import { Genus } from "../src/NEAT/Genus.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("previous", () => {
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

  // The population is already sorted in the desired order
  for (let i = 0; i < neat.population.length; i++) {
    const creature = neat.population[i];
    genus.addCreature(creature);
  }
  const breed = new Breed(genus, neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  return deDuplicator.previousExperiment(key);
}

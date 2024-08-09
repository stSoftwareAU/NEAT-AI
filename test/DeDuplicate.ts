import { assertEquals, assertFalse } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { Breed } from "../src/NEAT/Breed.ts";
import { Genus } from "../src/NEAT/Genus.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Neat } from "../src/NEAT/Neat.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { DeDuplicator } from "../src/architecture/DeDuplicator.ts";
import { CreatureUtil } from "../mod.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("DeDuplicate", () => {
  const creature: CreatureInternal = {
    neurons: [
      {
        bias: 0,
        index: 5,
        type: "hidden",
        squash: "IDENTITY",
      },
      {
        bias: 0.1,
        index: 6,
        type: "output",
        squash: "IDENTITY",
      },
      {
        bias: 0.2,
        index: 7,
        type: "output",
        squash: "IDENTITY",
      },
    ],
    synapses: [
      {
        weight: -0.1,
        from: 1,
        to: 5,
      },
      {
        weight: 0.2,
        from: 4,
        to: 7,
      },
      {
        weight: 0.1,
        from: 5,
        to: 6,
      },
    ],
    input: 5,
    output: 2,
    tags: [
      { name: "hello", value: "world" },
    ],
    score: -0.1111,
  };
  const n0 = Creature.fromJSON(creature).exportJSON();

  const n1 = Creature.fromJSON(n0);
  const UUID1 = CreatureUtil.makeUUID(n1);
  const n2 = Creature.fromJSON(n0);
  const UUID2 = CreatureUtil.makeUUID(n2);

  assertEquals(UUID1, UUID2);
  const list = [n1, n2];
  const neat = new Neat(1, 1, {}, []);

  for (let i = 0; i < neat.config.populationSize * 2; i++) {
    const n = Creature.fromJSON(n0);
    list.push(n);
  }
  const mutator = new Mutator(neat.config);
  const genus = new Genus();

  const breed = new Breed(genus, neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);
  deDuplicator.perform(list);

  const uniques = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const key = CreatureUtil.makeUUID(list[i]);

    assertFalse(uniques.has(key), `Duplicate found ${key}`);
    uniques.add(key);
  }
});

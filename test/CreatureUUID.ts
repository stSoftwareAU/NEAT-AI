import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import { Neat } from "../src/NEAT/Neat.ts";
import { DeDuplicator } from "../src/architecture/DeDuplicator.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Breed } from "../src/NEAT/Breed.ts";
import { Genus } from "../src/NEAT/Genus.ts";
import { ModBias } from "../src/mutate/ModBias.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("knownName", () => {
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

  const uuid = CreatureUtil.makeUUID(creature);

  console.log("UUID", uuid);

  assert(
    uuid == "49b13413-88b9-5688-92f5-ba59bb761639",
    "Wrong UUID was: " + uuid,
  );
});

Deno.test("ignoreTags", () => {
  const creature = Creature.fromJSON({
    uuid: crypto.randomUUID(),
    neurons: [
      {
        uuid: "hidden-0",
        bias: 0,
        index: 5,
        type: "hidden",
        squash: "IDENTITY",
      },
      {
        uuid: "output-0",
        bias: 0.1,
        index: 6,
        type: "output",
        squash: "IDENTITY",
      },
      {
        uuid: "output-1",
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
  });

  const clean = Creature.fromJSON(creature);
  clean.validate();
  assertEquals(
    creature.uuid,
    clean.uuid,
    `Should match creature: ${creature.uuid}, clean: ${clean.uuid}`,
  );
  delete clean.uuid;
  delete clean.score;
  delete clean.tags;

  const uuid0 = CreatureUtil.makeUUID(
    Creature.fromJSON(creature),
  );
  delete creature.uuid;
  const uuid1 = CreatureUtil.makeUUID(
    Creature.fromJSON(creature),
  );

  assertNotEquals(uuid0, uuid1);

  const uuid2 = CreatureUtil.makeUUID(clean);

  assertEquals(uuid2, uuid1, `Should match uuid2: ${uuid2}, uuid1: ${uuid1}`);

  const alive = Creature.fromJSON(creature);
  const uuid3 = CreatureUtil.makeUUID(alive);

  assertEquals(uuid3, uuid1, "Alive creature should match was: " + uuid3);

  /** Manually update if needed. */
  assert(
    uuid2 == "b08e3db1-f508-5106-b5c6-dfec158a1334",
    "Wrong UUID was: " + uuid2,
  );
});

Deno.test("keepUUID", () => {
  const creature: CreatureInternal = {
    uuid: crypto.randomUUID(),
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

  const n1 = Creature.fromJSON(creature);
  const j1 = n1.internalJSON();
  const n2 = Creature.fromJSON(j1);

  assertEquals(
    n2.uuid,
    creature.uuid,
    "Exported creature should match was: " + n2.uuid,
  );
});

Deno.test("generateUUID", () => {
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

  const n1 = Creature.fromJSON(creature);

  const neat = new Neat(1, 1, {}, []);
  const mutator = new Mutator(neat.config);
  const genus = new Genus();

  // The population is already sorted in the desired order
  for (let i = 0; i < neat.population.length; i++) {
    const creature = neat.population[i];
    genus.addCreature(creature);
  }
  const breed = new Breed(genus, neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);
  deDuplicator.perform([n1]);

  const uuid1 = n1.uuid;
  assert(n1.uuid, "deDuplicate should create UUIDs: " + n1.uuid);

  const modBias = new ModBias(n1);
  modBias.mutate();
  deDuplicator.perform([n1]);

  assertNotEquals(
    uuid1,
    n1.uuid,
    "modifying should change the UUID: " + n1.uuid,
  );
});

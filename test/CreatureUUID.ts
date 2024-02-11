import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.215.0/assert/mod.ts";
import { Creature } from "../src/Creature.ts";
import { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../src/architecture/CreatureUtils.ts";
import { Neat } from "../src/architecture/Neat.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("knownName", async () => {
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

  const uuid = await CreatureUtil.makeUUID(creature);

  console.log("UUID", uuid);

  assert(
    uuid == "df3405ad-5650-549a-975d-f46211716cd4",
    "Wrong UUID was: " + uuid,
  );
});

Deno.test("ignoreTags", async () => {
  const creature = Creature.fromJSON({
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
  });

  const clean = Creature.fromJSON(creature);
  assertEquals(
    creature.uuid,
    clean.uuid,
    `Should match creature: ${creature.uuid}, clean: ${clean.uuid}`,
  );
  delete clean.uuid;
  delete clean.score;
  delete clean.tags;

  const uuid0 = await CreatureUtil.makeUUID(
    Creature.fromJSON(creature),
  );
  delete creature.uuid;
  const uuid1 = await CreatureUtil.makeUUID(
    Creature.fromJSON(creature),
  );

  assertNotEquals(uuid0, uuid1);

  const uuid2 = await CreatureUtil.makeUUID(clean);

  assertEquals(uuid2, uuid1, `Should match uuid2: ${uuid2}, uuid1: ${uuid1}`);

  const alive = Creature.fromJSON(creature);
  const uuid3 = await CreatureUtil.makeUUID(alive);

  assertEquals(uuid3, uuid1, "Alive creature should match was: " + uuid3);

  /** Manually update if needed. */
  assert(
    uuid2 == "87dc2a04-b5a2-5bf9-bfb5-dd9419f2f962",
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

Deno.test("generateUUID", async () => {
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
  await neat.deDuplicate([n1]);

  const uuid1 = n1.uuid;
  assert(n1.uuid, "deDuplicate should create UUIDs: " + n1.uuid);

  n1.modBias();
  await neat.deDuplicate([n1]);

  assertNotEquals(
    uuid1,
    n1.uuid,
    "modifying should change the UUID: " + n1.uuid,
  );
});

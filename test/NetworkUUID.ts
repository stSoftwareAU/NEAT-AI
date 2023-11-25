import { NetworkInternal } from "../src/architecture/NetworkInterfaces.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Network } from "../src/architecture/Network.ts";
import { NetworkUtil } from "../src/architecture/NetworkUtils.ts";
import { Neat } from "../src/Neat.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("knownName", async () => {
  const creature = Network.fromJSON({
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
  console.info(creature);
  //  console.info( JSON.stringify( creature, null, 2));
  const uuid = await NetworkUtil.makeUUID(creature);

  console.log("UUID", uuid);

  assert(
    uuid == "7750d0bf-6972-5e4b-92f5-1bbd9da220f7",
    "Wrong UUID was: " + uuid,
  );
});

Deno.test("ignoreTags", async () => {
  const creature = Network.fromJSON({
    uuid: crypto.randomUUID(),
    nodes: [
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
    connections: [
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

  const clean = Network.fromJSON(creature);
  assertEquals(
    creature.uuid,
    clean.uuid,
    `Should match creature: ${creature.uuid}, clean: ${clean.uuid}`,
  );
  delete clean.uuid;
  delete clean.score;
  delete clean.tags;

  const uuid0 = await NetworkUtil.makeUUID(
    Network.fromJSON(creature),
  );
  delete creature.uuid;
  const uuid1 = await NetworkUtil.makeUUID(
    Network.fromJSON(creature),
  );

  assertNotEquals(uuid0, uuid1);

  const uuid2 = await NetworkUtil.makeUUID(clean);

  console.log("uuid1", uuid1, "uuid2", uuid2);

  assertEquals(uuid2, uuid1, `Should match uuid2: ${uuid2}, uuid1: ${uuid1}`);

  const alive = Network.fromJSON(creature);
  const uuid3 = await NetworkUtil.makeUUID(alive);

  assertEquals(uuid3, uuid1, "Alive creature should match was: " + uuid3);

  /** Manually update if needed. */
  assert(
    uuid2 == "91c2c15c-3ba4-52de-bf60-5c1c129875b2",
    "Wrong UUID was: " + uuid2,
  );
});

Deno.test("keepUUID", () => {
  const creature: NetworkInternal = {
    uuid: crypto.randomUUID(),
    nodes: [
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
    connections: [
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

  const n1 = Network.fromJSON(creature);
  const j1 = n1.internalJSON();
  const n2 = Network.fromJSON(j1);

  assertEquals(
    n2.uuid,
    creature.uuid,
    "Exported creature should match was: " + n2.uuid,
  );
});

Deno.test("generateUUID", async () => {
  const creature: NetworkInternal = {
    nodes: [
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
    connections: [
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

  const n1 = Network.fromJSON(creature);

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

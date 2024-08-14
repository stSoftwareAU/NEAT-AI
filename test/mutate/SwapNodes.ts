import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { type CreatureExport, CreatureUtil } from "../../mod.ts";
import { SwapNeurons } from "../../src/mutate/SwapNeurons.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("SwapNodes-Constant", () => {
  const json: CreatureExport = {
    neurons: [
      {
        type: "constant",
        uuid: "62f93f73-82bc-47d1-a840-5546eb0971ca",
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "75dfec22-e546-4738-b50c-be2f4a0f842b",
        bias: 0.6,
        squash: "LOGISTIC",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 0,
        squash: "MAXIMUM",
      },
    ],
    synapses: [
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "75dfec22-e546-4738-b50c-be2f4a0f842b",
      },
      {
        weight: 1,
        fromUUID: "62f93f73-82bc-47d1-a840-5546eb0971ca",
        toUUID: "output-0",
      },
      {
        weight: 1,
        fromUUID: "75dfec22-e546-4738-b50c-be2f4a0f842b",
        toUUID: "output-0",
      },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  const uuid1 = CreatureUtil.makeUUID(creature);
  const swapNodes = new SwapNeurons(creature);
  for (let i = 100; i--;) {
    if (swapNodes.mutate()) break;
  }

  creature.validate();
  Creature.fromJSON(creature.exportJSON());

  const uuid2 = creature.uuid;
  assertEquals(uuid1, uuid2);
  delete creature.uuid;

  const uuid3 = CreatureUtil.makeUUID(creature);
  assertEquals(uuid1, uuid3);
});

Deno.test("SwapNodes-Short", () => {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "75dfec22-e546-4738-b50c-be2f4a0f842b",
        bias: 0.6,
        squash: "LOGISTIC",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 0,
        squash: "MAXIMUM",
      },
    ],
    synapses: [
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "75dfec22-e546-4738-b50c-be2f4a0f842b",
      },
      {
        weight: 1,
        fromUUID: "75dfec22-e546-4738-b50c-be2f4a0f842b",
        toUUID: "output-0",
      },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  const uuid1 = CreatureUtil.makeUUID(creature);
  const swapNodes = new SwapNeurons(creature);
  for (let i = 100; i--;) {
    if (swapNodes.mutate()) break;
  }

  creature.validate();
  Creature.fromJSON(creature.exportJSON());

  const uuid2 = creature.uuid;
  assertEquals(uuid1, uuid2);
  delete creature.uuid;

  const uuid3 = CreatureUtil.makeUUID(creature);
  assertEquals(uuid1, uuid3);
});

Deno.test("SwapNodes-Valid", () => {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "62f93f73-82bc-47d1-a840-5546eb0971ca",
        squash: "LeakyReLU",
        bias: 0.5,
      },
      {
        type: "hidden",
        uuid: "75dfec22-e546-4738-b50c-be2f4a0f842b",
        bias: 0.6,
        squash: "LOGISTIC",
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 0,
        squash: "MAXIMUM",
      },
    ],
    synapses: [
      {
        weight: -0.1,
        fromUUID: "input-1",
        toUUID: "62f93f73-82bc-47d1-a840-5546eb0971ca",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "75dfec22-e546-4738-b50c-be2f4a0f842b",
      },
      {
        weight: 1,
        fromUUID: "62f93f73-82bc-47d1-a840-5546eb0971ca",
        toUUID: "output-0",
      },
      {
        weight: 1,
        fromUUID: "75dfec22-e546-4738-b50c-be2f4a0f842b",
        toUUID: "output-0",
      },
    ],
    input: 2,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  const uuid1 = CreatureUtil.makeUUID(creature);
  const swapNodes = new SwapNeurons(creature);
  for (let i = 100; i--;) {
    if (swapNodes.mutate()) break;
  }

  creature.validate();

  delete creature.uuid;

  const uuid2 = CreatureUtil.makeUUID(creature);
  assertNotEquals(uuid1, uuid2);
});

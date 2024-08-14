import { assertNotEquals } from "@std/assert";
import { type CreatureExport, CreatureUtil } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { ModActivation } from "../../src/mutate/ModActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("ModActivation-Constant", () => {
  const json: CreatureExport = {
    neurons: [
      {
        type: "constant",
        uuid: "62f93f73-82bc-47d1-a840-5546eb0971ca",
        bias: 0.5,
      },
      {
        type: "output",
        uuid: "output-0",
        bias: 0,
        squash: "MAXIMUM",
      },
      {
        type: "output",
        uuid: "output-1",
        bias: 0,
        squash: "MINIMUM",
      },
      {
        type: "output",
        uuid: "output-2",
        bias: 0,
        squash: "LeakyReLU",
      },
    ],
    synapses: [
      {
        weight: 1,
        fromUUID: "62f93f73-82bc-47d1-a840-5546eb0971ca",
        toUUID: "output-0",
      },
      {
        weight: 1,
        fromUUID: "input-0",
        toUUID: "output-0",
      },
      {
        weight: 0.1,
        fromUUID: "input-0",
        toUUID: "output-1",
      },
      {
        weight: 0.2,
        fromUUID: "input-0",
        toUUID: "output-2",
      },
    ],
    input: 1,
    output: 3,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  const uuid1 = CreatureUtil.makeUUID(creature);
  const modifier = new ModActivation(creature);
  for (let i = 100; i--;) {
    modifier.mutate();
  }

  creature.validate();

  delete creature.uuid;

  const uuid2 = CreatureUtil.makeUUID(creature);
  assertNotEquals(uuid1, uuid2);
});

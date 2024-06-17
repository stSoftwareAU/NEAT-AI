import { assert, assertNotEquals } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags";
import { Creature, type CreatureExport, CreatureUtil } from "../../mod.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";

function makeCreature(name: string) {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: `${name}-3`, squash: "CLIPPED", bias: 2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: `${name}-3`, weight: -0.3 },
      { fromUUID: "input-1", toUUID: `${name}-3`, weight: 0.3 },

      { fromUUID: `${name}-3`, toUUID: "output-0", weight: 0.6 },

      { fromUUID: `${name}-3`, toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  addTag(json.synapses[0], "hello", name);
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

Deno.test("TagSynapse", async () => {
  const mum = makeCreature("mum");
  const mumUUID = await CreatureUtil.makeUUID(mum);
  const dad = makeCreature("dad");
  const dadUUID = await CreatureUtil.makeUUID(dad);
  const baby = await Offspring.breed(mum, dad);

  assert(baby);

  const babyUUID = await CreatureUtil.makeUUID(baby);

  const message = getTag(baby.synapses[0], "hello");
  assert(/^(mum|dad)$/.test(`${message}`), `Lost name ${message}`);

  assertNotEquals(mumUUID, dadUUID);

  assertNotEquals(mumUUID, babyUUID);
});

import { assert, assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

Deno.test("discovery records store errors as numeric arrays", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 1,
      },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Activate once so the internal state reflects actual output values.
  const input = new Float32Array([0.5]);
  creature.activate(input);

  const expected = new Float32Array([0]);
  const discoverMap = creature.record(expected);

  const record = discoverMap.get("output-0");
  assert(record, "expected a discovery record for output-0");

  const { errors } = record as unknown as { errors: unknown };
  assert(Array.isArray(errors), "errors should be stored as an array");
  assert(errors.length > 0, "errors should contain at least one entry");

  for (const value of errors) {
    assertEquals(typeof value, "number");
  }
});

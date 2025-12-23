import { assert } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { ArcTan } from "../../../src/methods/activations/types/ArcTan.ts";

Deno.test("Creature.record: ArcTan saturation does not produce astronomical errors", () => {
  const creatureJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      {
        uuid: "output-0",
        type: "output",
        squash: ArcTan.NAME,
        bias: 0,
      },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        // Drive the pre-squash value deep into saturation.
        weight: 1_000_000,
      },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);

  // Activate once so record() has a current activation/value to compare against.
  creature.activate(new Float32Array([1]));

  // Request an impossible activation well beyond ArcTan's range; it will be clamped.
  const expected = new Float32Array([Math.PI]);
  const map = creature.record(expected);
  const rec = map.get("output-0");
  assert(rec, "Expected a record for output-0");

  const err = rec.errors[0];
  assert(Number.isFinite(err), `Expected finite error, got ${err}`);

  // If record() produces errors of ~1e15 here, downstream MSE ends up ~1e30+.
  // We deliberately keep this bounded to prevent Explorer + discovery from blowing up.
  assert(
    Math.abs(err) < 1e9,
    `Expected non-astronomical error, got ${err}`,
  );
});

/**
 * Behavioural checks for the serialisation contract (see `AGENTS.md` and the
 * `exportJSON` docblock in `CreatureSerialization.ts`). The policy itself is
 * enforced by review: do not add full `creatureValidate` on every export/import.
 */
import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { exportJSON } from "../../src/creature/CreatureSerialization.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test({
  name:
    "exportJSON: toggling DEBUG does not change export for the same valid creature",
  fn: async () => {
    await initWasmForTests();

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    creature.DEBUG = false;
    const fast = exportJSON(creature);
    creature.DEBUG = true;
    const checked = exportJSON(creature);

    assertEquals(JSON.stringify(fast), JSON.stringify(checked));
  },
});

Deno.test({
  name: "Creature.fromJSON: validate defaults to false (hot import path)",
  fn: async () => {
    await initWasmForTests();

    const source = new Creature(2, 1, { layers: [{ count: 2 }] });
    source.DEBUG = false;
    const json = source.exportJSON();

    const roundTrip = Creature.fromJSON(json);
    assertEquals(roundTrip.input, source.input);
    assertEquals(roundTrip.output, source.output);
  },
});

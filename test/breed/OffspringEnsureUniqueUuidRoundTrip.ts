import { assert } from "@std/assert";
import { Creature } from "../../mod.ts";
import { Offspring } from "@architecture/Offspring.ts";

/** Test access to private static used in graft path (#2086). */
function ensureUniqueNeuronUuidsForTest(creature: Creature): void {
  (Offspring as unknown as { ensureUniqueNeuronUuids(c: Creature): void })
    .ensureUniqueNeuronUuids(creature);
}

/**
 * Issue #2086: duplicate hidden `uuid` values break UUID-only export/import;
 * `ensureUniqueNeuronUuids` must run before graft round-trips that use
 * `exportJSON` / `loadFrom`.
 */
Deno.test("Offspring.ensureUniqueNeuronUuids: duplicate hidden UUIDs survive export round-trip after dedupe", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.semanticVersion = "4.0.0";
  creature.forwardOnly = true;

  const shared = "intentional-duplicate-hidden-uuid";
  creature.neurons[creature.input].uuid = shared;
  creature.neurons[creature.input + 1].uuid = shared;

  ensureUniqueNeuronUuidsForTest(creature);

  const hiddenUuids = new Set<string>();
  for (
    let i = creature.input;
    i < creature.neurons.length - creature.output;
    i++
  ) {
    const u = creature.neurons[i].uuid;
    assert(u !== undefined && u.length > 0);
    assert(
      !hiddenUuids.has(u),
      `expected unique hidden uuid after dedupe, saw duplicate ${u}`,
    );
    hiddenUuids.add(u);
  }

  const roundTrip = Creature.fromJSON(creature.exportJSON(), false);
  roundTrip.validate({ forwardOnly: true });
});

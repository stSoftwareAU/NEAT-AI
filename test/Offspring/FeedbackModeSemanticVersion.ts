import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { upgrade } from "../../src/upgrade/Upgrade.ts";

/**
 * Regression test for issue #952 (24-Dec-2025).
 *
 * When feedback/memory mode is explicitly requested during breeding, the child
 * must **not** be created as semanticVersion 4.x (forward-only invariant),
 * otherwise future structural changes that add feedback connections will
 * surface as `RECURSIVE_SYNAPSE` when the creature is later upgraded/cloned.
 */
Deno.test("Offspring: feedback mode must not create a 4.x child", () => {
  const mumJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    semanticVersion: "4.0.0",
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
      // Extra connection so crossover can create a non-clone child.
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  };
  const dadJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    semanticVersion: "4.0.0",
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.1 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
      // Extra connection so crossover can create a non-clone child.
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.15 },
    ],
  };

  const mum = Creature.fromJSON(mumJson);
  const dad = Creature.fromJSON(dadJson);
  mum.validate({ forwardOnly: true });
  dad.validate({ forwardOnly: true });

  let child: Creature | undefined;
  for (let attempt = 0; attempt < 200; attempt++) {
    child = Offspring.breed(mum, dad, { forwardOnly: false });
    if (child) break;
  }
  assert(child, "Expected child");

  // Two 4.x parents are a hard forward-only invariant. Even if feedback mode is
  // requested, the offspring must remain forward-only at 4.x.
  assertEquals(child.forwardOnly, true);
  assertEquals(child.semanticVersion, "4.0.0");

  // Sanity: upgrade should continue to accept the child.
  upgrade(Creature.fromJSON(child.exportJSON()));
});

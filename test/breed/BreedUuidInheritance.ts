/**
 * Breeding must not invent new stable wire-format uuids for neurons copied from
 * parents: every hidden/constant `neuron.uuid` on the child must appear on at
 * least one parent (Issue #2050 regression guard).
 *
 * Fixtures mirror `test/feedForward/ForwardOnlyFlag.ts` (proven to produce children).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

function hiddenAndConstantWireUuids(creature: Creature): Set<string> {
  const out = new Set<string>();
  for (const n of creature.neurons) {
    if (n.type === "hidden" || n.type === "constant") {
      if (n.uuid !== undefined && n.uuid !== "") {
        out.add(n.uuid);
      }
    }
  }
  return out;
}

function unionSets(a: Set<string>, b: Set<string>): Set<string> {
  const u = new Set(a);
  for (const x of b) u.add(x);
  return u;
}

/** Same topology as ForwardOnlyFlag — both parents share `hidden-0` so crossover can succeed. */
function makeMum(): Creature {
  const mumJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.0 },
    ],
  };
  return Creature.fromJSON(mumJson);
}

function makeDad(): Creature {
  const dadJson: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: IDENTITY.NAME, bias: 0.1 },
      { type: "output", uuid: "output-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.1 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.2 },
    ],
  };
  return Creature.fromJSON(dadJson);
}

Deno.test(
  "Offspring.breed — child hidden/constant wire uuids are subset of parents",
  () => {
    const mum = makeMum();
    const dad = makeDad();
    const allowed = unionSets(
      hiddenAndConstantWireUuids(mum),
      hiddenAndConstantWireUuids(dad),
    );

    let child: Creature | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      child = Offspring.breed(mum, dad, { forwardOnly: true });
      if (child) break;
    }
    assert(child, "Expected a child from breed");

    for (const uuid of hiddenAndConstantWireUuids(child)) {
      assert(
        allowed.has(uuid),
        `Child uuid '${uuid}' must come from a parent; allowed: ${
          [...allowed].join(", ")
        }`,
      );
    }
  },
);

Deno.test(
  "Bred child — hidden/constant wire uuids survive export/import (next generation can reload)",
  () => {
    const mum = makeMum();
    const dad = makeDad();

    let gen1: Creature | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      gen1 = Offspring.breed(mum, dad, { forwardOnly: true });
      if (gen1) break;
    }
    assert(gen1, "Expected child from breed");

    const reloaded = Creature.fromJSON(gen1.exportJSON());
    assertEquals(
      [...hiddenAndConstantWireUuids(gen1)].sort(),
      [...hiddenAndConstantWireUuids(reloaded)].sort(),
      "Wire uuids must be stable across save/load of a bred creature",
    );
  },
);

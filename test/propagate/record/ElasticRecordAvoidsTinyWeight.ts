import { assert } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";

Deno.test("record: avoids attributing error to tiny-weight links", () => {
  // If record attribution pushes value-space error into a link with an extremely
  // small weight, the implied upstream activation target becomes enormous:
  //   targetFromActivation = (fromValue + share) / weight
  //
  // This test creates two parallel parents feeding an IDENTITY output:
  // - parent-tiny has huge activation but tiny weight (so tiny contribution)
  // - parent-big has normal activation and normal weight (so real contribution)
  //
  // We expect record() to recurse mainly into parent-big and NOT generate an
  // astronomical error on parent-tiny.
  const creatureJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "parent-tiny", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "parent-big", type: "hidden", squash: IDENTITY.NAME, bias: 0 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      // Drive parent activations.
      { fromUUID: "input-0", toUUID: "parent-tiny", weight: 1000 }, // activation ~1000
      { fromUUID: "input-1", toUUID: "parent-big", weight: 1 }, // activation ~1

      // Two inbound links into output:
      { fromUUID: "parent-tiny", toUUID: "output-0", weight: 1e-6 },
      { fromUUID: "parent-big", toUUID: "output-0", weight: 1 },
    ],
  };

  const creature = Creature.fromJSON(creatureJSON);
  creature.activate(new Float32Array([1, 1]));

  // Current output ≈ (1000 * 1e-6) + (1 * 1) = 1.001. Target 0 => error ~ -1.001.
  const discoverMap = creature.record(new Float32Array([0]));

  const tiny = discoverMap.get("parent-tiny");
  const big = discoverMap.get("parent-big");

  assert(big, "Expected record entry for parent-big");

  if (tiny) {
    const finite = tiny.errors.filter(Number.isFinite);
    const maxAbs = finite.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    assert(
      maxAbs < 1e6,
      `Expected tiny-weight parent to be de-emphasised, got maxAbs=${maxAbs}`,
    );
  }
});

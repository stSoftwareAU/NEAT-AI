import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { compactCreature } from "../../src/compact/CompactCreature.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { ABSOLUTE } from "../../src/methods/activations/types/ABSOLUTE.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

function maxAbsWeightAndBias(creature: Creature): number {
  let max = 0;
  for (const s of creature.synapses) max = Math.max(max, Math.abs(s.weight));
  for (const n of creature.neurons) {
    if (n.type !== "input") max = Math.max(max, Math.abs(n.bias));
  }
  return max;
}

Deno.test("compactCreature: simplifies large weights around ABSOLUTE without changing behaviour (issue #642)", () => {
  // Arrange:
  // input-0 --(1e6)--> hidden-0(ABSOLUTE, bias 1e6) --(1e-6)--> output-0(IDENTITY)
  //
  // output = 1e-6 * abs(1e6*x + 1e6) = abs(x + 1)
  const json: CreatureExport = {
    neurons: [
      {
        uuid: "hidden-0",
        type: "hidden",
        squash: ABSOLUTE.NAME,
        bias: 1e6,
      },
      {
        uuid: "output-0",
        type: "output",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1e6 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1e-6 },
    ],
    input: 1,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  const beforeMax = maxAbsWeightAndBias(creature);
  assert(
    beforeMax >= 1e6,
    "Sanity check: expected a very large starting value",
  );

  // Act
  const compacted = compactCreature(creature, true);

  // Assert
  assert(compacted, "Expected compaction to occur (weight normalisation)");
  compacted.validate();

  const afterMax = maxAbsWeightAndBias(compacted);
  assert(
    afterMax < beforeMax,
    `Expected max abs weight/bias to reduce (before=${beforeMax}, after=${afterMax})`,
  );

  // Behaviour should be preserved.
  const inputs = [-3, -1, -0.25, 0, 0.25, 1, 3];
  for (const x of inputs) {
    const a = creature.activate(new Float32Array([x]), false)[0];
    const b = compacted.activate(new Float32Array([x]), false)[0];
    assertAlmostEquals(a, b, 1e-6, `x=${x} expected=${a} actual=${b}`);
  }
});

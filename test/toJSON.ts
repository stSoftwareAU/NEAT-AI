import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { assert } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { SynapseInternal } from "../src/architecture/SynapseInterfaces.ts";

Deno.test("useUUIDinsteadOfPosition", () => {
  const creature: CreatureInternal = {
    uuid: "60d9fde3-465a-4022-956a-c425fc8e62cc",
    neurons: [
      {
        bias: 0,
        index: 5,
        type: "hidden",
        squash: "IDENTITY",
      },
      {
        bias: 0.1,
        index: 6,
        type: "output",
        squash: "IDENTITY",
      },
      {
        bias: 0.2,
        index: 7,
        type: "output",
        squash: "IDENTITY",
      },
    ],
    synapses: [
      {
        weight: -0.1,
        from: 1,
        to: 5,
      },
      {
        weight: 0.2,
        from: 4,
        to: 7,
      },
      {
        weight: 0.1,
        from: 5,
        to: 6,
      },
    ],
    input: 5,
    output: 2,
    tags: [
      { name: "hello", value: "world" },
    ],
    score: -0.1111,
  };

  const n1 = Creature.fromJSON(creature);
  const exported = n1.exportJSON();

  exported.neurons.forEach((n) => {
    const indx = (n as { index?: number }).index;
    assert(!Number.isFinite(indx), `should NOT have an index ${indx}`);
  });

  exported.synapses.forEach((c) => {
    const from = ((c as unknown) as SynapseInternal).from;
    assert(!Number.isFinite(from), `should NOT have an from ${from}`);
  });
});

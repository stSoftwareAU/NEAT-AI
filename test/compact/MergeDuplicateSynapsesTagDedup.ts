import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { mergeDuplicateSynapses } from "../../src/compact/CompactUtils.ts";

Deno.test("mergeDuplicateSynapses: de-duplicates tags by {name,value} (not reference equality)", () => {
  // Two distinct objects with identical {name,value}.
  const t1 = { name: "meta", value: "same" };
  const t2 = { name: "meta", value: "same" };

  const exportJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [{
      type: "output",
      uuid: "output-0",
      squash: "IDENTITY",
      bias: 0,
    }],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 0.25,
        tags: [t1],
      },
      {
        fromUUID: "input-0",
        toUUID: "output-0",
        weight: 0.75,
        tags: [t2],
      },
    ],
  };

  mergeDuplicateSynapses(exportJSON);

  assertEquals(exportJSON.synapses.length, 1);
  assertEquals(exportJSON.synapses[0].weight, 1.0);
  assertEquals(exportJSON.synapses[0].tags?.length, 1);
  assertEquals(exportJSON.synapses[0].tags?.[0].name, "meta");
  assertEquals(exportJSON.synapses[0].tags?.[0].value, "same");
});

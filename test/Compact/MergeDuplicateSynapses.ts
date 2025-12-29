import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { mergeDuplicateSynapses } from "../../src/compact/CompactUtils.ts";

const tagA = { name: "tag", value: "a" };
const tagB = { name: "tag", value: "b" };

Deno.test("mergeDuplicateSynapses: merges same from/to/type (sums weights), preserves typed separation, clears memetic", () => {
  const exportJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-0", toUUID: "output-0", weight: -0.2, tags: [tagB] },
      // Typed duplicates should merge with same type only.
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.1,
        type: "condition",
        tags: [tagA],
      },
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.2,
        type: "condition",
        tags: [tagB],
      },
      // Different type should remain separate.
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.3,
        type: "positive",
      },
    ],
    memetic: { generation: 0, score: 0, biases: {}, weights: {} },
  };

  const result = mergeDuplicateSynapses(exportJSON);
  assertEquals(result.merged, 2);
  assertEquals(exportJSON.memetic, undefined);

  // Should now have 3 synapses: merged output edge, merged condition edge, and positive edge.
  assertEquals(exportJSON.synapses.length, 3);

  const out = exportJSON.synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "output-0"
  );
  assertEquals(out?.weight, 0.3);

  const condition = exportJSON.synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "hidden-0" &&
    s.type === "condition"
  );
  assertEquals(condition?.weight, 0.3);
  const tagValues = new Set((condition?.tags ?? []).map((t) => t.value));
  assertEquals(tagValues, new Set(["a", "b"]));

  const positive = exportJSON.synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "hidden-0" && s.type === "positive"
  );
  assertEquals(positive?.weight, 0.3);
});

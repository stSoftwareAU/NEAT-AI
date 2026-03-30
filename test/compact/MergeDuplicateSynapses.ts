import { assertAlmostEquals, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { mergeDuplicateSynapses } from "@compact/CompactUtils.ts";

const tagA = { name: "tag", value: "a" };
const tagB = { name: "tag", value: "b" };

Deno.test("mergeDuplicateSynapses: merges same from/to (sums weights), clears memetic", () => {
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
  assertEquals(result.merged, 3);
  assertEquals(exportJSON.memetic, undefined);

  assertEquals(exportJSON.synapses.length, 2);

  const out = exportJSON.synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "output-0"
  );
  assertEquals(out?.weight, 0.3);

  const hiddenIn = exportJSON.synapses.find((s) =>
    s.fromUUID === "input-0" && s.toUUID === "hidden-0"
  );
  assertAlmostEquals(hiddenIn?.weight ?? 0, 0.6);
  assertEquals(hiddenIn?.type, "condition");
  const tagValues = new Set((hiddenIn?.tags ?? []).map((t) => t.value));
  assertEquals(tagValues, new Set(["a", "b"]));
});

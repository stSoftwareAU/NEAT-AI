import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { pruneZeroWeightSynapses } from "../../src/compact/CompactUtils.ts";

Deno.test("pruneZeroWeightSynapses: keeps typed synapses and protects IF targets", () => {
  const exportJSON: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "if-0", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      // A zero-weight, untyped synapse to a normal output should be pruned.
      { fromUUID: "input-0", toUUID: "output-0", weight: 0 },

      // IF requires typed inbound connections; these must never be pruned.
      {
        fromUUID: "input-0",
        toUUID: "if-0",
        weight: 0,
        type: "condition",
      },
      { fromUUID: "input-0", toUUID: "if-0", weight: 0.2, type: "positive" },
      { fromUUID: "input-0", toUUID: "if-0", weight: -0.2, type: "negative" },

      // Extra safety: even untyped zero-weight edges to IF targets are preserved.
      { fromUUID: "input-0", toUUID: "if-0", weight: 0 },
    ],
    memetic: { generation: 0, score: 0, biases: {}, weights: {} },
  };

  const result = pruneZeroWeightSynapses(exportJSON);
  assertEquals(result.removedSynapses, 1);
  assertEquals(exportJSON.memetic, undefined);

  // We should keep 4 synapses (3 typed required by IF + 1 untyped zero to IF).
  assertEquals(exportJSON.synapses.length, 4);
  assertEquals(
    exportJSON.synapses.filter((s) => s.toUUID === "if-0").length,
    4,
  );
  assertEquals(
    exportJSON.synapses.some((s) => s.toUUID === "output-0" && s.weight === 0),
    false,
  );
});

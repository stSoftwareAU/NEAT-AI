import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../mod.ts";
import { pruneZeroWeightSynapses } from "../../src/compact/CompactUtils.ts";

Deno.test("pruneZeroWeightSynapses: keeps typed synapses, protects IF targets, and never disconnects outputs", () => {
  const exportJSON: CreatureExport = {
    input: 1,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "if-0", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: -0.2 },
    ],
    synapses: [
      // When an output has other inbound connections, a zero-weight, untyped
      // synapse should be pruned.
      { fromUUID: "input-0", toUUID: "output-0", weight: 0 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.3 },

      // Structural safety: when an output would otherwise have zero inbound
      // connections, preserve the last inbound synapse (even if its weight is 0).
      { fromUUID: "input-0", toUUID: "output-1", weight: 0 },

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

  // We should keep 6 synapses:
  // - 2 inbound to output-0 (zero pruned, non-zero kept) => 1 remains
  // - 1 inbound to output-1 (kept for structural safety) => 1 remains
  // - 3 typed required by IF + 1 untyped zero to IF => 4 remain
  assertEquals(exportJSON.synapses.length, 6);
  assertEquals(
    exportJSON.synapses.filter((s) => s.toUUID === "if-0").length,
    4,
  );
  assertEquals(
    exportJSON.synapses.some((s) => s.toUUID === "output-0" && s.weight === 0),
    false,
  );
  assertEquals(
    exportJSON.synapses.some((s) =>
      s.toUUID === "output-0" && s.weight === 0.3
    ),
    true,
  );
  assertEquals(
    exportJSON.synapses.some((s) => s.toUUID === "output-1" && s.weight === 0),
    true,
  );
});

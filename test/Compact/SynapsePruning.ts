import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import {
  mergeDuplicateSynapses,
  pruneZeroWeightSynapses,
} from "../../src/compact/SynapsePruning.ts";
import type {
  MergeDuplicateSynapsesResult,
  PruneZeroWeightSynapsesResult,
} from "../../src/compact/SynapsePruning.ts";

Deno.test("SynapsePruning - direct import mergeDuplicateSynapses sums weights", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.2 },
    ],
  };

  const result: MergeDuplicateSynapsesResult = mergeDuplicateSynapses(exported);
  assertEquals(result.merged, 1);
  assertEquals(exported.synapses.length, 2);
  const merged = exported.synapses.find((s) => s.fromUUID === "input-0")!;
  assertEquals(merged.weight, 0.8);
});

Deno.test("SynapsePruning - direct import pruneZeroWeightSynapses removes zero-weight", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "LOGISTIC", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.7 },
    ],
  };

  const result: PruneZeroWeightSynapsesResult = pruneZeroWeightSynapses(
    exported,
  );
  assertEquals(result.removedSynapses, 1);
  assertEquals(exported.synapses.length, 2);
});

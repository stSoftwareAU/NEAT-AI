import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { pruneDeadSubgraphs } from "../../src/compact/DeadSubgraphPruning.ts";
import type { PruneDeadSubgraphsResult } from "../../src/compact/DeadSubgraphPruning.ts";

Deno.test("DeadSubgraphPruning - direct import removes dead neurons", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "dead-h", squash: "LOGISTIC", bias: 0.1 },
      { type: "hidden", uuid: "alive-h", squash: "LOGISTIC", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "dead-h", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "alive-h", weight: 0.4 },
      { fromUUID: "alive-h", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const result: PruneDeadSubgraphsResult = pruneDeadSubgraphs(exported);
  assertEquals(result.removedNeurons, 1);
  assertEquals(exported.neurons.length, 2);
});

Deno.test("DeadSubgraphPruning - direct import no dead returns zero", () => {
  const exported: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const result = pruneDeadSubgraphs(exported);
  assertEquals(result.removedNeurons, 0);
  assertEquals(result.removedSynapses, 0);
});

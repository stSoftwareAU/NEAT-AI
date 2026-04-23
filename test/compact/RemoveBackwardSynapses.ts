import { assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { removeBackwardSynapses } from "@compact/RemoveBackwardSynapses.ts";

Deno.test("removeBackwardSynapses: strips synapses that point backwards in neuron order", () => {
  const exported: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: "IDENTITY", bias: 0 },
      { uuid: "hidden-1", type: "hidden", squash: "IDENTITY", bias: 0 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
      // Forward synapse (hidden-0 → hidden-1) — must survive.
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.5 },
      // Backward synapse (hidden-1 → hidden-0) — must be removed.
      { fromUUID: "hidden-1", toUUID: "hidden-0", weight: 0.25 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };
  normaliseCreatureExport(exported);

  const beforeCount = exported.synapses.length;
  const result = removeBackwardSynapses(exported);

  assertEquals(result.removedSynapses, 1);
  assertEquals(exported.synapses.length, beforeCount - 1);

  // The surviving synapses are all forward.
  const uuidIndex = new Map(
    exported.neurons.map((n, i) => [n.uuid ?? `__${i}`, i]),
  );
  for (const s of exported.synapses) {
    const fromIdx = uuidIndex.get(s.fromUUID!);
    const toIdx = uuidIndex.get(s.toUUID!);
    if (fromIdx !== undefined && toIdx !== undefined) {
      // Feed-forward: source must appear no later than the target.
      if (fromIdx > toIdx) {
        throw new Error(
          `Backward synapse survived: ${s.fromUUID} → ${s.toUUID}`,
        );
      }
    }
  }
});

Deno.test("removeBackwardSynapses: no-op when the network is already feed-forward", () => {
  const exported: CreatureExport = {
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: "IDENTITY", bias: 0 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
    ],
    input: 1,
    output: 1,
  };
  normaliseCreatureExport(exported);

  const snapshot = JSON.stringify(exported);
  const result = removeBackwardSynapses(exported);

  assertEquals(result.removedSynapses, 0);
  assertEquals(JSON.stringify(exported), snapshot);
});

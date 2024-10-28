import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { chooseNeurons } from "../../../src/propagate/sparse/ChooseNeurons.ts";

Deno.test("chooseNeurons - clustering with sparseRatio < 1", () => {
  const creature = makeCreature();

  // Set sparseRatio to 0.3 (30%) to select a subset of neurons with clustering.
  const config = createBackPropagationConfig({ sparseRatio: 0.3 });
  const selectedNeurons = chooseNeurons(creature.exportJSON(), config);

  console.log("Selected neurons:", selectedNeurons);

  // Verify that selected neurons include fewer than all eligible neurons.
  const eligibleNeurons = creature.neurons.filter(
    (neuron) => neuron.type === "hidden" || neuron.type === "output",
  );
  assert(selectedNeurons.size < eligibleNeurons.length);

  // Verify that each selected neuron has at least one connected neuron within two steps.
  selectedNeurons.forEach((neuronUUID) => {
    const neighbors = getClusteredNeighbors(neuronUUID, creature.exportJSON());
    const hasClusteredNeighbor = Array.from(neighbors).some(
      (neighborUUID) => selectedNeurons.has(neighborUUID),
    );
    assert(
      hasClusteredNeighbor,
      `Neuron ${neuronUUID} should have a connected neighbor`,
    );
  });
});

Deno.test("chooseNeurons - sparseRatio 1 selects all eligible neurons", () => {
  const creature = makeCreature();

  // Set sparseRatio to 1 to select all eligible neurons.
  const config = createBackPropagationConfig({ sparseRatio: 1 });
  const selectedNeurons = chooseNeurons(creature.exportJSON(), config);

  // Verify that all eligible neurons are selected.
  const expectedNeurons = new Set(
    creature.neurons
      .filter((neuron) => neuron.type === "hidden" || neuron.type === "output")
      .map((neuron) => neuron.uuid),
  );
  assertEquals(selectedNeurons, expectedNeurons);
});

// Helper function to create a small creature for testing.
function makeCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", bias: 0 },
      { type: "hidden", uuid: "hidden-1", bias: 0 },
      { type: "hidden", uuid: "hidden-2", bias: 0 },
      { type: "hidden", uuid: "hidden-3", bias: 0 },
      { type: "hidden", uuid: "hidden-4a", bias: 0 },
      { type: "hidden", uuid: "hidden-4b", bias: 0 },
      { type: "hidden", uuid: "hidden-4c", bias: 0 },
      { type: "hidden", uuid: "hidden-4d", bias: 0 },
      { type: "output", uuid: "output-0", bias: 0 },
      { type: "output", uuid: "output-1", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.5 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.5 },
      { fromUUID: "hidden-3", toUUID: "hidden-4a", weight: 0.5 },
      { fromUUID: "hidden-3", toUUID: "hidden-4b", weight: 0.5 },
      { fromUUID: "hidden-3", toUUID: "hidden-4c", weight: 0.5 },
      { fromUUID: "hidden-3", toUUID: "hidden-4d", weight: 0.5 },
      { fromUUID: "hidden-4a", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "hidden-4b", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "hidden-4c", toUUID: "output-1", weight: 0.5 },
      { fromUUID: "hidden-4d", toUUID: "output-1", weight: 0.5 },
    ],
    input: 2,
    output: 2,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

// Helper function to find clustered neighbors within two steps for testing purposes.
function getClusteredNeighbors(
  neuronUUID: string,
  creature: CreatureExport,
): Set<string> {
  const synapseMap = new Map<string, Set<string>>();

  creature.synapses.forEach((synapse) => {
    if (!synapseMap.has(synapse.fromUUID)) {
      synapseMap.set(synapse.fromUUID, new Set());
    }
    if (!synapseMap.has(synapse.toUUID)) {
      synapseMap.set(synapse.toUUID, new Set());
    }
    synapseMap.get(synapse.fromUUID)!.add(synapse.toUUID);
    synapseMap.get(synapse.toUUID)!.add(synapse.fromUUID); // bidirectional for clustering
  });

  // Perform BFS to find neighbors within two steps.
  const visited = new Set<string>();
  const queue = [{ neuronUUID, depth: 0 }];

  while (queue.length > 0) {
    const { neuronUUID: current, depth } = queue.shift()!;
    if (depth >= 2) continue;

    const neighbors = synapseMap.get(current) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ neuronUUID: neighbor, depth: depth + 1 });
      }
    }
  }

  return visited;
}

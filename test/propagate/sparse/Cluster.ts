import { assert, assertEquals, fail } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { createBackPropagationConfig } from "../../../src/propagate/BackPropagation.ts";
import { chooseNeurons } from "../../../src/propagate/sparse/ChooseNeurons.ts";

Deno.test("chooseNeurons - clustering with sparseRatio < 1", () => {
  const creature = makeCreature();

  const validNeurons = new Set<number>();
  creature.neurons.filter((neuron) => {
    if (neuron.type === "hidden" || neuron.type === "output") {
      validNeurons.add(neuron.id);
    }
  });

  // Set sparseRatio to 0.3 (30%) to select a subset of neurons with clustering.
  const config = createBackPropagationConfig({ sparseRatio: 0.3 });
  const selectedNeurons = chooseNeurons(creature.exportInternalJSON(), config);

  console.log("Selected neurons:", selectedNeurons);

  selectedNeurons.forEach((neuronId) => {
    if (!validNeurons.has(neuronId)) {
      fail(`${neuronId} not a valid neuron`);
    }
  });

  // Verify that selected neurons include fewer than all eligible neurons.
  const eligibleNeurons = creature.neurons.filter(
    (neuron) => neuron.type === "hidden" || neuron.type === "output",
  );
  assert(selectedNeurons.size < eligibleNeurons.length);

  // Verify that each selected neuron has at least one connected neuron within two steps.
  selectedNeurons.forEach((neuronId) => {
    const neighbours = getClusteredNeighbours(
      neuronId,
      creature.exportInternalJSON(),
    );
    const hasClusteredNeighbour = Array.from(neighbours).some(
      (neighbourId) => selectedNeurons.has(neighbourId),
    );
    assert(
      hasClusteredNeighbour,
      `Neuron ${neuronId} should have a connected neighbour`,
    );
  });
});

Deno.test("chooseNeurons - sparseRatio 1 selects all eligible neurons", () => {
  const creature = makeCreature();

  // Set sparseRatio to 1 to select all eligible neurons.
  const config = createBackPropagationConfig({ sparseRatio: 1 });
  const selectedNeurons = chooseNeurons(creature.exportInternalJSON(), config);

  // Verify that all eligible neurons are selected.
  const expectedNeurons = new Set(
    creature.neurons
      .filter((neuron) => neuron.type === "hidden" || neuron.type === "output")
      .map((neuron) => neuron.id),
  );
  assertEquals(selectedNeurons, expectedNeurons);
});

// Helper function to create a small creature for testing.
function makeCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "hidden-1", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "hidden-2", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "hidden-3", bias: 0, squash: "RELU" },
      { type: "constant", uuid: "const-3a", bias: 1 },
      { type: "hidden", uuid: "hidden-4a", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "hidden-4b", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "hidden-4c", bias: 0, squash: "RELU" },
      { type: "hidden", uuid: "hidden-4d", bias: 0, squash: "RELU" },
      { type: "output", uuid: "output-0", bias: 0, squash: "RELU" },
      { type: "output", uuid: "output-1", bias: 0, squash: "RELU" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.5 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-3", weight: 0.5 },

      { fromUUID: "const-3a", toUUID: "hidden-4a", weight: -0.1 },
      { fromUUID: "const-3a", toUUID: "hidden-4b", weight: -0.2 },
      { fromUUID: "const-3a", toUUID: "hidden-4c", weight: -0.3 },
      { fromUUID: "const-3a", toUUID: "hidden-4d", weight: -0.4 },

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

// Helper function to find clustered neighbours within two steps for testing purposes.
// Uses index pointer instead of Array.shift() for O(1) dequeue operations.
function getClusteredNeighbours(
  neuronId: number,
  creature: CreatureExport,
): Set<number> {
  const synapseMap = new Map<number, Set<number>>();

  creature.synapses.forEach((synapse) => {
    if (synapse.fromId === undefined || synapse.toId === undefined) return;
    if (!synapseMap.has(synapse.fromId)) {
      synapseMap.set(synapse.fromId, new Set());
    }
    if (!synapseMap.has(synapse.toId)) {
      synapseMap.set(synapse.toId, new Set());
    }
    synapseMap.get(synapse.fromId)!.add(synapse.toId);
    synapseMap.get(synapse.toId)!.add(synapse.fromId); // bidirectional for clustering
  });

  // Perform BFS to find neighbours within two steps.
  const visited = new Set<number>();
  const queue = [{ neuronId, depth: 0 }];
  let front = 0;

  while (front < queue.length) {
    const { neuronId: current, depth } = queue[front++];
    if (depth >= 2) continue;

    const neighbours = synapseMap.get(current);
    if (!neighbours) continue;
    for (const neighbour of neighbours) {
      if (!visited.has(neighbour)) {
        visited.add(neighbour);
        queue.push({ neuronId: neighbour, depth: depth + 1 });
      }
    }
  }

  return visited;
}

/**
 * Issue #2285 — Benchmark sortNeurons before/after topological sort optimisation.
 *
 * Measures the cost of `Offspring.sortNeurons()` in isolation by building
 * realistic parent/child neuron arrays and timing the sort directly.
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/SortNeuronsTopological.ts
 */

import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Offspring } from "@architecture/Offspring.ts";
import type { ConnectionRef } from "@architecture/Offspring.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { AddConnection } from "@mutate/AddConnection.ts";

/**
 * Build a creature of a specified size using mutation operators
 * from a minimal base. Produces valid forward-only creatures
 * with realistic topology.
 */
function buildCreatureOfSize(
  inputCount: number,
  outputCount: number,
  hiddenNeuronTarget: number,
): Creature {
  const creature = new Creature(inputCount, outputCount);

  let attempts = 0;
  while (
    creature.neurons.length - inputCount - outputCount < hiddenNeuronTarget &&
    attempts < hiddenNeuronTarget * 10
  ) {
    try {
      const addNeuron = new AddNeuron(creature);
      addNeuron.mutate();
      creature.fix();
    } catch {
      // Some mutations may fail — expected
    }
    attempts++;
  }

  const targetSynapses = Math.min(
    hiddenNeuronTarget * 4,
    creature.neurons.length * (creature.neurons.length - 1) / 4,
  );
  attempts = 0;
  while (creature.synapses.length < targetSynapses && attempts < 5000) {
    try {
      const addConn = new AddConnection(creature);
      addConn.mutate();
      creature.fix();
    } catch {
      // Connection already exists or otherwise invalid
    }
    attempts++;
  }

  return creature;
}

/**
 * Build a child neuron array and connectionsMap from two parents,
 * simulating the crossover phase output that sortNeurons receives.
 */
function buildSortInputs(mother: Creature, father: Creature) {
  // Merge neurons from both parents (mimicking crossover)
  const neuronMap = new Map<
    number,
    { neuron: typeof mother.neurons[0]; parent: Creature }
  >();

  for (const node of mother.neurons) {
    neuronMap.set(node.id, { neuron: node, parent: mother });
  }
  for (const node of father.neurons) {
    if (!neuronMap.has(node.id) || Math.random() >= 0.5) {
      neuronMap.set(node.id, { neuron: node, parent: father });
    }
  }

  const child = Array.from(neuronMap.values()).map((entry) => entry.neuron);
  // Scramble to make sort non-trivial
  child.sort(() => Math.random() - 0.5);

  const connectionsMap = new Map<number, ConnectionRef>();
  for (const entry of neuronMap.values()) {
    const node = entry.neuron;
    if (node.type !== "input") {
      const connections = entry.parent.inwardConnections(node.index);
      connectionsMap.set(node.id, {
        parent: entry.parent,
        synapses: connections,
      });
    }
  }

  return { child, connectionsMap };
}

// ──────────────────────────────────────────────────────────────────
// Benchmark configurations
// ──────────────────────────────────────────────────────────────────

interface BenchConfig {
  label: string;
  inputCount: number;
  outputCount: number;
  hiddenNeurons: number;
  iterations: number;
}

const configurations: BenchConfig[] = [
  {
    label: "Small (~10 neurons)",
    inputCount: 3,
    outputCount: 1,
    hiddenNeurons: 6,
    iterations: 100,
  },
  {
    label: "Medium (~30 neurons)",
    inputCount: 5,
    outputCount: 2,
    hiddenNeurons: 23,
    iterations: 50,
  },
  {
    label: "Large (~80 neurons)",
    inputCount: 8,
    outputCount: 3,
    hiddenNeurons: 69,
    iterations: 20,
  },
];

for (const cfg of configurations) {
  Deno.bench({
    name: `sortNeurons: ${cfg.label}`,
    fn: () => {
      const mother = buildCreatureOfSize(
        cfg.inputCount,
        cfg.outputCount,
        cfg.hiddenNeurons,
      );
      CreatureUtil.makeUUID(mother);

      const father = buildCreatureOfSize(
        cfg.inputCount,
        cfg.outputCount,
        cfg.hiddenNeurons,
      );
      CreatureUtil.makeUUID(father);

      for (let i = 0; i < cfg.iterations; i++) {
        const { child, connectionsMap } = buildSortInputs(mother, father);
        try {
          Offspring.sortNeurons(
            child,
            mother.neurons,
            father.neurons,
            connectionsMap,
          );
        } catch {
          // Some random configurations may not sort — expected
        }
      }
    },
  });
}

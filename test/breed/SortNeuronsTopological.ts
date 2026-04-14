/**
 * Issue #2285 — Verify that the topological sort in sortNeurons()
 * produces a valid dependency order for offspring neurons.
 *
 * These are "what" tests: they verify outcomes (valid ordering),
 * not implementation details (which algorithm is used).
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import type { ConnectionRef } from "@architecture/Offspring.ts";
import { Offspring } from "@architecture/Offspring.ts";

/**
 * Build a chain creature: input → A → B → C → output.
 * This tests that the sort respects linear dependency chains.
 */
function makeChainCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "chain-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "chain-b", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "chain-c", squash: "IDENTITY", bias: 0 },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "chain-a", weight: 1 },
      { fromUUID: "chain-a", toUUID: "chain-b", weight: 1 },
      { fromUUID: "chain-b", toUUID: "chain-c", weight: 1 },
      { fromUUID: "chain-c", toUUID: "output-0", weight: 1 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(json);
}

/**
 * Build a diamond creature: input → A → B, input → A → C, B → D, C → D → output.
 * This tests that the sort handles multi-path dependencies correctly.
 */
function makeDiamondCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "dia-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "dia-b", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "dia-c", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "dia-d", squash: "IDENTITY", bias: 0 },
      { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "dia-a", weight: 1 },
      { fromUUID: "dia-a", toUUID: "dia-b", weight: 1 },
      { fromUUID: "dia-a", toUUID: "dia-c", weight: 1 },
      { fromUUID: "dia-b", toUUID: "dia-d", weight: 1 },
      { fromUUID: "dia-c", toUUID: "dia-d", weight: 1 },
      { fromUUID: "dia-d", toUUID: "output-0", weight: 1 },
    ],
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(json);
}

/**
 * Build a wide creature with many independent hidden neurons that all
 * depend only on inputs. This tests parallel (non-dependent) neurons.
 */
function makeWideCreature(hiddenCount: number): Creature {
  const neurons = [];
  const synapses = [];
  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden" as const,
      uuid: `wide-${i}`,
      squash: "IDENTITY" as const,
      bias: 0,
    });
    synapses.push({ fromUUID: "input-0", toUUID: `wide-${i}`, weight: 1 });
    synapses.push({ fromUUID: `wide-${i}`, toUUID: "output-0", weight: 1 });
  }
  neurons.push({
    type: "output" as const,
    squash: "IDENTITY" as const,
    uuid: "output-0",
    bias: 0,
  });

  const json: CreatureExport = {
    neurons,
    synapses,
    input: 2,
    output: 1,
  };
  return Creature.fromJSON(json);
}

/**
 * Helper: build a connectionsMap for a creature's neurons.
 */
function buildConnectionsMap(
  creature: Creature,
): Map<number, ConnectionRef> {
  const map = new Map<number, ConnectionRef>();
  for (const node of creature.neurons) {
    if (node.type !== "input") {
      const connections = creature.inwardConnections(node.index);
      map.set(node.id, { parent: creature, synapses: connections });
    }
  }
  return map;
}

/**
 * Helper: verify that all non-input dependencies of each neuron appear
 * earlier in the sorted array (valid topological order).
 */
function assertValidTopologicalOrder(
  sorted: Creature["neurons"],
  connectionsMap: Map<number, ConnectionRef>,
) {
  const positionOf = new Map<number, number>();
  for (let i = 0; i < sorted.length; i++) {
    positionOf.set(sorted[i].id, i);
  }

  for (let i = 0; i < sorted.length; i++) {
    const neuron = sorted[i];
    if (neuron.type === "input" || neuron.type === "output") continue;

    const ref = connectionsMap.get(neuron.id);
    if (!ref) continue;

    const parentNeurons = ref.parent.neurons;
    for (const synapse of ref.synapses) {
      const fromNeuron = parentNeurons[synapse.from];
      if (fromNeuron.type === "input") continue;

      const fromPos = positionOf.get(fromNeuron.id);
      assert(
        fromPos !== undefined && fromPos < i,
        `Neuron ${neuron.uuid ?? neuron.id} at position ${i} depends on ` +
          `${fromNeuron.uuid ?? fromNeuron.id} at position ${
            fromPos ?? "missing"
          } — ` +
          `dependency must appear earlier`,
      );
    }
  }
}

Deno.test(
  "sortNeurons produces valid topological order for chain dependency",
  () => {
    const creature = makeChainCreature();
    creature.validate();
    const connectionsMap = buildConnectionsMap(creature);

    // Scramble the neurons
    const scrambled = creature.neurons.slice().sort(() => Math.random() - 0.5);

    Offspring.sortNeurons(
      scrambled,
      creature.neurons,
      creature.neurons, // use same creature as both parents
      connectionsMap,
    );

    // Verify type ordering: inputs first, outputs last
    const inputCount = scrambled.filter((n) => n.type === "input").length;
    for (let i = 0; i < inputCount; i++) {
      assertEquals(scrambled[i].type, "input");
    }
    assertEquals(scrambled[scrambled.length - 1].type, "output");

    // Verify topological order
    assertValidTopologicalOrder(scrambled, connectionsMap);

    // Verify specific chain order: A before B before C
    const aPos = scrambled.findIndex((n) => n.uuid === "chain-a");
    const bPos = scrambled.findIndex((n) => n.uuid === "chain-b");
    const cPos = scrambled.findIndex((n) => n.uuid === "chain-c");
    assert(aPos < bPos, "chain-a must come before chain-b");
    assert(bPos < cPos, "chain-b must come before chain-c");
  },
);

Deno.test(
  "sortNeurons produces valid topological order for diamond dependency",
  () => {
    const creature = makeDiamondCreature();
    creature.validate();
    const connectionsMap = buildConnectionsMap(creature);

    const scrambled = creature.neurons.slice().sort(() => Math.random() - 0.5);

    Offspring.sortNeurons(
      scrambled,
      creature.neurons,
      creature.neurons,
      connectionsMap,
    );

    assertValidTopologicalOrder(scrambled, connectionsMap);

    // A must come before B, C, and D
    const aPos = scrambled.findIndex((n) => n.uuid === "dia-a");
    const dPos = scrambled.findIndex((n) => n.uuid === "dia-d");
    assert(aPos < dPos, "dia-a must come before dia-d");
  },
);

Deno.test(
  "sortNeurons handles wide independent neurons correctly",
  () => {
    const creature = makeWideCreature(20);
    creature.validate();
    const connectionsMap = buildConnectionsMap(creature);

    const scrambled = creature.neurons.slice().sort(() => Math.random() - 0.5);

    Offspring.sortNeurons(
      scrambled,
      creature.neurons,
      creature.neurons,
      connectionsMap,
    );

    assertValidTopologicalOrder(scrambled, connectionsMap);

    // All hidden neurons should come before output
    const outputPos = scrambled.findIndex((n) => n.type === "output");
    for (let i = 0; i < scrambled.length; i++) {
      if (scrambled[i].type === "hidden") {
        assert(i < outputPos, "hidden neurons must come before output");
      }
    }
  },
);

Deno.test(
  "sortNeurons produces valid order with two different parents",
  () => {
    // Mother has chain: input → A → B → output
    const mumJson: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "shared-a", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "shared-b", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "mum-only", squash: "IDENTITY", bias: 0 },
        { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "shared-a", weight: 1 },
        { fromUUID: "shared-a", toUUID: "shared-b", weight: 1 },
        { fromUUID: "shared-b", toUUID: "mum-only", weight: 1 },
        { fromUUID: "mum-only", toUUID: "output-0", weight: 1 },
      ],
      input: 2,
      output: 1,
    };
    const mum = Creature.fromJSON(mumJson);
    mum.validate();

    // Father has: input → A → B → output, input → dad-only → output
    const dadJson: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "shared-a", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "shared-b", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "dad-only", squash: "IDENTITY", bias: 0 },
        { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "shared-a", weight: 1 },
        { fromUUID: "shared-a", toUUID: "shared-b", weight: 1 },
        { fromUUID: "input-1", toUUID: "dad-only", weight: 1 },
        { fromUUID: "dad-only", toUUID: "output-0", weight: 1 },
        { fromUUID: "shared-b", toUUID: "output-0", weight: 1 },
      ],
      input: 2,
      output: 1,
    };
    const dad = Creature.fromJSON(dadJson);
    dad.validate();

    // Child has neurons from both parents
    const childJson: CreatureExport = {
      neurons: [
        { type: "hidden", uuid: "shared-a", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "shared-b", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "mum-only", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "dad-only", squash: "IDENTITY", bias: 0 },
        { type: "output", squash: "IDENTITY", uuid: "output-0", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "shared-a", weight: 1 },
        { fromUUID: "shared-a", toUUID: "shared-b", weight: 1 },
        { fromUUID: "shared-b", toUUID: "mum-only", weight: 1 },
        { fromUUID: "input-1", toUUID: "dad-only", weight: 1 },
        { fromUUID: "mum-only", toUUID: "output-0", weight: 1 },
        { fromUUID: "dad-only", toUUID: "output-0", weight: 1 },
      ],
      input: 2,
      output: 1,
    };
    const child = Creature.fromJSON(childJson);
    child.validate();

    const connectionsMap = buildConnectionsMap(child);

    // Scramble
    const scrambled = child.neurons.slice().sort(() => Math.random() - 0.5);

    Offspring.sortNeurons(
      scrambled,
      mum.neurons,
      dad.neurons,
      connectionsMap,
    );

    assertValidTopologicalOrder(scrambled, connectionsMap);

    // Shared-a must come before shared-b, shared-b before mum-only
    const aPos = scrambled.findIndex((n) => n.uuid === "shared-a");
    const bPos = scrambled.findIndex((n) => n.uuid === "shared-b");
    const mumPos = scrambled.findIndex((n) => n.uuid === "mum-only");
    assert(aPos < bPos, "shared-a before shared-b");
    assert(bPos < mumPos, "shared-b before mum-only");
  },
);

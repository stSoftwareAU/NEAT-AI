import { assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import type { SynapseExport } from "../../src/architecture/SynapseInterfaces.ts";

function makeMum() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "common-a", squash: "IDENTITY", bias: 0.1 },

      { type: "hidden", uuid: "mum-a", squash: "IDENTITY", bias: -0.9 },

      { type: "hidden", uuid: "common-b", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "mum-b", squash: "IDENTITY", bias: -0.8 },

      { type: "hidden", uuid: "common-c", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "mum-c", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "common-d", squash: "IDENTITY", bias: 0.1 },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "common-b", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "common-a", weight: -0.3 },
      { fromUUID: "common-a", toUUID: "mum-a", weight: 0.3 },
      { fromUUID: "mum-a", toUUID: "common-b", weight: 0.3 },

      { fromUUID: "common-b", toUUID: "mum-b", weight: 0.6 },
      { fromUUID: "mum-b", toUUID: "common-c", weight: 0.31 },
      { fromUUID: "common-c", toUUID: "mum-c", weight: 0.33 },
      { fromUUID: "mum-c", toUUID: "common-d", weight: 0.33 },
      { fromUUID: "common-c", toUUID: "output-0", weight: 0.31 },
      { fromUUID: "common-d", toUUID: "output-0", weight: 0.32 },
      { fromUUID: "common-a", toUUID: "output-1", weight: 0.34 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeDad() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "common-a", squash: "IDENTITY", bias: 0.1 },

      { type: "hidden", uuid: "dad-a", squash: "IDENTITY", bias: -0.9 },

      { type: "hidden", uuid: "common-b", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "dad-b", squash: "IDENTITY", bias: -0.8 },
      { type: "hidden", uuid: "dad-b2", squash: "IDENTITY", bias: -0.8 },

      { type: "hidden", uuid: "dad-c", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "common-d", squash: "IDENTITY", bias: 0.1 },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "common-b", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "common-a", weight: -0.3 },
      { fromUUID: "common-a", toUUID: "dad-a", weight: 0.3 },
      { fromUUID: "dad-a", toUUID: "common-b", weight: 0.3 },

      { fromUUID: "common-b", toUUID: "dad-b", weight: 0.6 },
      { fromUUID: "dad-b", toUUID: "output-0", weight: 0.31 },
      { fromUUID: "common-a", toUUID: "dad-b2", weight: 0.33 },
      { fromUUID: "dad-b2", toUUID: "dad-c", weight: 0.33 },
      { fromUUID: "dad-c", toUUID: "common-d", weight: 0.33 },
      { fromUUID: "dad-b", toUUID: "output-1", weight: 0.32 },
      { fromUUID: "common-d", toUUID: "output-0", weight: 0.33 },
      { fromUUID: "common-a", toUUID: "output-1", weight: 0.32 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

function makeChild() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "dad-a", squash: "IDENTITY", bias: -0.9 },
      { type: "hidden", uuid: "mum-a", squash: "IDENTITY", bias: -0.9 },

      { type: "hidden", uuid: "common-b", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "dad-b", squash: "IDENTITY", bias: -0.8 },

      { type: "hidden", uuid: "common-c", squash: "IDENTITY", bias: 0.1 },

      { type: "hidden", uuid: "dad-c", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "mum-c", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "common-d", squash: "IDENTITY", bias: 0.1 },

      { type: "hidden", uuid: "common-a", squash: "IDENTITY", bias: 0.1 },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "common-b", weight: -0.3 },
      { fromUUID: "input-1", toUUID: "common-a", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "dad-a", weight: 0.3 },
      { fromUUID: "dad-a", toUUID: "mum-a", weight: 0.3 },
      { fromUUID: "mum-a", toUUID: "common-b", weight: 0.3 },

      { fromUUID: "common-b", toUUID: "dad-b", weight: 0.6 },
      { fromUUID: "dad-b", toUUID: "common-c", weight: 0.31 },
      { fromUUID: "common-c", toUUID: "mum-c", weight: 0.33 },
      { fromUUID: "common-c", toUUID: "dad-c", weight: 0.33 },
      { fromUUID: "dad-c", toUUID: "output-1", weight: 0.33 },
      { fromUUID: "mum-c", toUUID: "common-d", weight: 0.33 },
      { fromUUID: "common-c", toUUID: "output-0", weight: 0.31 },
      { fromUUID: "common-d", toUUID: "output-0", weight: 0.32 },
      { fromUUID: "common-a", toUUID: "output-1", weight: 0.34 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

Deno.test(
  "Sort Neurons",
  () => {
    const mum = makeMum();
    const dad = makeDad();
    const child = makeChild();

    const connectionsMap = new Map<string, SynapseExport[]>();

    for (const node of child.neurons) {
      if (node.type !== "input") {
        const connections = child.inwardConnections(node.index);
        connectionsMap.set(
          node.uuid,
          Offspring.cloneConnections(child, connections),
        );
      }
    }

    const scrambled = child.neurons.slice().sort(() => Math.random() - 0.5);

    const sorted = scrambled.slice();
    Offspring.sortNeurons(
      sorted,
      mum.neurons,
      dad.neurons,
      connectionsMap,
    );

    sorted.forEach((n) => console.info(n.uuid));

    assertEquals(sorted[0].uuid, "input-0");
    assertEquals(sorted[1].uuid, "input-1");
    assertEquals(sorted[2].uuid, "input-2");
    assertEquals(sorted[3].uuid, "common-a");
    assertEquals(sorted[4].uuid, "dad-a");
    assertEquals(sorted[5].uuid, "mum-a");

    assertEquals(sorted[sorted.length - 3].uuid, "common-d");
    assertEquals(sorted[sorted.length - 2].uuid, "output-0");
    assertEquals(sorted[sorted.length - 1].uuid, "output-1");
  },
);

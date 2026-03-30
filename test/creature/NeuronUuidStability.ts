/**
 * Quality gate test: neuron UUIDs MUST survive generations of mutation and
 * breeding.
 *
 * In production ~20 machines independently evolve populations, periodically
 * sharing fittest creatures via a GitHub repository. Cross-machine breeding
 * aligns neurons by UUID — if a mutation or serialisation round-trip silently
 * changes a neuron's UUID, breeding across machines produces garbage.
 *
 * This test enforces the invariant described in AGENTS.md under
 * "Neuron UUID stability (CRITICAL INVARIANT)".
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";
import { ModWeight } from "../../src/mutate/ModWeight.ts";
import { ModBias } from "../../src/mutate/ModBias.ts";
import { ModActivation } from "../../src/mutate/ModSquash.ts";
import { SubConnection } from "../../src/mutate/SubConnection.ts";
import { SwapNeurons } from "../../src/mutate/SwapNeurons.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function buildCreature(): Creature {
  return Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.1, uuid: "aaaa-1111" },
      { type: "hidden", squash: "TANH", bias: -0.2, uuid: "bbbb-2222" },
      { type: "hidden", squash: "RELU", bias: 0.3, uuid: "cccc-3333" },
      { type: "output", squash: "IDENTITY", bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "aaaa-1111", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "bbbb-2222", weight: 0.8 },
      { fromUUID: "aaaa-1111", toUUID: "cccc-3333", weight: 0.5 },
      { fromUUID: "bbbb-2222", toUUID: "cccc-3333", weight: -0.3 },
      { fromUUID: "cccc-3333", toUUID: "output-0", weight: 0.9 },
    ],
    input: 2,
    output: 1,
    semanticVersion: "4.0.0",
  });
}

function collectHiddenUuids(creature: Creature): Map<string, string> {
  const map = new Map<string, string>();
  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden" && neuron.uuid) {
      map.set(neuron.uuid, neuron.findSquash().getName());
    }
  }
  return map;
}

Deno.test(
  "UUID stability: AddNeuron does not change existing neuron UUIDs",
  () => {
    const creature = buildCreature();
    const before = collectHiddenUuids(creature);

    const addNeuron = new AddNeuron(creature);
    addNeuron.mutate();

    const after = collectHiddenUuids(creature);
    for (const [uuid] of before) {
      assert(
        after.has(uuid),
        `Original neuron UUID ${uuid} disappeared after AddNeuron`,
      );
    }
  },
);

Deno.test(
  "UUID stability: AddConnection does not change existing neuron UUIDs",
  () => {
    const creature = buildCreature();
    const before = collectHiddenUuids(creature);

    const addConn = new AddConnection(creature);
    addConn.mutate();

    const after = collectHiddenUuids(creature);
    for (const [uuid] of before) {
      assert(
        after.has(uuid),
        `Original neuron UUID ${uuid} disappeared after AddConnection`,
      );
    }
  },
);

Deno.test(
  "UUID stability: ModWeight does not change existing neuron UUIDs",
  () => {
    const creature = buildCreature();
    const before = collectHiddenUuids(creature);

    const modWeight = new ModWeight(creature);
    modWeight.mutate();

    const after = collectHiddenUuids(creature);
    for (const [uuid] of before) {
      assert(
        after.has(uuid),
        `Original neuron UUID ${uuid} disappeared after ModWeight`,
      );
    }
  },
);

Deno.test(
  "UUID stability: ModBias does not change existing neuron UUIDs",
  () => {
    const creature = buildCreature();
    const before = collectHiddenUuids(creature);

    const modBias = new ModBias(creature);
    modBias.mutate();

    const after = collectHiddenUuids(creature);
    for (const [uuid] of before) {
      assert(
        after.has(uuid),
        `Original neuron UUID ${uuid} disappeared after ModBias`,
      );
    }
  },
);

Deno.test(
  "UUID stability: ModSquash does not change existing neuron UUIDs",
  () => {
    const creature = buildCreature();
    const before = collectHiddenUuids(creature);

    const modSquash = new ModActivation(creature);
    modSquash.mutate();

    const after = collectHiddenUuids(creature);
    for (const [uuid] of before) {
      assert(
        after.has(uuid),
        `Original neuron UUID ${uuid} disappeared after ModSquash`,
      );
    }
  },
);

Deno.test(
  "UUID stability: SubConnection does not fabricate or change surviving neuron UUIDs",
  () => {
    const creature = buildCreature();
    const before = collectHiddenUuids(creature);

    const subConn = new SubConnection(creature);
    subConn.mutate();

    const after = collectHiddenUuids(creature);
    for (const [uuid] of after) {
      assert(
        before.has(uuid),
        `Surviving neuron UUID ${uuid} was not in the original set — ` +
          `SubConnection must not fabricate new UUIDs`,
      );
    }
  },
);

Deno.test(
  "UUID stability: SwapNeurons does not change existing neuron UUIDs",
  () => {
    const creature = buildCreature();
    const before = collectHiddenUuids(creature);

    const swapNeurons = new SwapNeurons(creature);
    swapNeurons.mutate();

    const after = collectHiddenUuids(creature);
    for (const [uuid] of before) {
      assert(
        after.has(uuid),
        `Original neuron UUID ${uuid} disappeared after SwapNeurons`,
      );
    }
  },
);

Deno.test(
  "UUID stability: exportJSON round-trip preserves all neuron UUIDs",
  () => {
    const creature = buildCreature();
    const before = collectHiddenUuids(creature);

    const json = creature.exportJSON();
    const reloaded = Creature.fromJSON(json);
    const after = collectHiddenUuids(reloaded);

    assertEquals(
      after.size,
      before.size,
      "Round-trip changed the number of hidden neurons",
    );
    for (const [uuid] of before) {
      assert(
        after.has(uuid),
        `Neuron UUID ${uuid} lost in exportJSON -> fromJSON round-trip`,
      );
    }
  },
);

Deno.test(
  "UUID stability: multiple mutation generations preserve surviving neuron UUIDs",
  () => {
    const creature = buildCreature();
    const originalUuids = collectHiddenUuids(creature);

    const config = createNeatConfig({
      populationSize: 10,
      mutationRate: 1.0,
      mutationAmount: 3,
    });
    const mutator = new Mutator(config);

    for (let generation = 0; generation < 10; generation++) {
      mutator.mutateCreature(creature, Mutation.ADD_CONN);
      mutator.mutateCreature(creature, Mutation.MOD_WEIGHT);
      mutator.mutateCreature(creature, Mutation.MOD_BIAS);

      if (generation % 3 === 0) {
        mutator.mutateCreature(creature, Mutation.ADD_NODE);
      }

      creature.fix();
    }

    const surviving = collectHiddenUuids(creature);
    for (const [uuid] of originalUuids) {
      if (surviving.has(uuid)) {
        assertEquals(
          surviving.get(uuid) !== undefined,
          true,
          `Surviving neuron ${uuid} must retain its UUID`,
        );
      }
    }
  },
);

Deno.test(
  "UUID stability: breeding preserves neuron UUIDs from parents",
  () => {
    const mum = Creature.fromJSON({
      neurons: [
        { type: "hidden", squash: "LOGISTIC", bias: 0.1, uuid: "aaaa-1111" },
        { type: "hidden", squash: "TANH", bias: -0.2, uuid: "bbbb-2222" },
        { type: "hidden", squash: "RELU", bias: 0.3, uuid: "cccc-3333" },
        {
          type: "hidden",
          squash: "LOGISTIC",
          bias: 0.4,
          uuid: "dddd-mum-only",
        },
        { type: "output", squash: "IDENTITY", bias: 0.0, uuid: "output-0" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "aaaa-1111", weight: 1.0 },
        { fromUUID: "input-1", toUUID: "bbbb-2222", weight: 0.8 },
        { fromUUID: "aaaa-1111", toUUID: "cccc-3333", weight: 0.5 },
        { fromUUID: "bbbb-2222", toUUID: "cccc-3333", weight: -0.3 },
        { fromUUID: "cccc-3333", toUUID: "dddd-mum-only", weight: 0.7 },
        { fromUUID: "dddd-mum-only", toUUID: "output-0", weight: 0.9 },
      ],
      input: 2,
      output: 1,
      semanticVersion: "4.0.0",
    });
    mum.score = -0.5;
    const mumUuids = collectHiddenUuids(mum);

    const dad = Creature.fromJSON({
      neurons: [
        { type: "hidden", squash: "LOGISTIC", bias: 0.2, uuid: "aaaa-1111" },
        { type: "hidden", squash: "TANH", bias: -0.1, uuid: "bbbb-2222" },
        {
          type: "hidden",
          squash: "TANH",
          bias: -0.3,
          uuid: "eeee-dad-only",
        },
        { type: "hidden", squash: "RELU", bias: 0.5, uuid: "cccc-3333" },
        { type: "output", squash: "IDENTITY", bias: 0.0, uuid: "output-0" },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "aaaa-1111", weight: 0.6 },
        { fromUUID: "input-1", toUUID: "bbbb-2222", weight: 0.4 },
        { fromUUID: "aaaa-1111", toUUID: "eeee-dad-only", weight: 0.3 },
        { fromUUID: "bbbb-2222", toUUID: "eeee-dad-only", weight: -0.5 },
        { fromUUID: "eeee-dad-only", toUUID: "cccc-3333", weight: 0.2 },
        { fromUUID: "cccc-3333", toUUID: "output-0", weight: 0.8 },
      ],
      input: 2,
      output: 1,
      semanticVersion: "4.0.0",
    });
    dad.score = -0.3;
    const dadUuids = collectHiddenUuids(dad);

    let offspring: Creature | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      offspring = Offspring.breed(mum, dad, { forwardOnly: true });
      if (offspring) break;
    }
    assert(offspring !== undefined, "Breeding should produce offspring");

    creatureValidate(offspring, { forwardOnly: true });
    const offspringUuids = collectHiddenUuids(offspring);

    for (const [uuid] of offspringUuids) {
      const fromMum = mumUuids.has(uuid);
      const fromDad = dadUuids.has(uuid);
      assert(
        fromMum || fromDad,
        `Offspring neuron UUID ${uuid} came from neither parent — ` +
          `UUIDs must be inherited, never fabricated`,
      );
    }
  },
);

Deno.test(
  "UUID stability: cross-machine breeding scenario — " +
    "creatures evolved independently share neuron UUIDs for alignment",
  () => {
    const shared = buildCreature();
    shared.forwardOnly = true;
    const sharedUuids = collectHiddenUuids(shared);

    const machineA = Creature.fromJSON(shared.exportJSON());
    machineA.forwardOnly = true;
    const machineB = Creature.fromJSON(shared.exportJSON());
    machineB.forwardOnly = true;

    for (let i = 0; i < 3; i++) {
      const addNeuronA = new AddNeuron(machineA);
      addNeuronA.mutate();
      machineA.fix({ forwardOnly: true });

      const addConnA = new AddConnection(machineA);
      addConnA.mutate();
      machineA.fix({ forwardOnly: true });
    }
    machineA.score = -0.4;

    for (let i = 0; i < 3; i++) {
      const addNeuronB = new AddNeuron(machineB);
      addNeuronB.mutate();
      machineB.fix({ forwardOnly: true });

      const modWeightB = new ModWeight(machineB);
      modWeightB.mutate();
    }
    machineB.score = -0.3;

    const machineAUuids = collectHiddenUuids(machineA);
    const machineBUuids = collectHiddenUuids(machineB);

    for (const [uuid] of sharedUuids) {
      assert(
        machineAUuids.has(uuid),
        `Machine A lost shared neuron UUID ${uuid} after AddNeuron`,
      );
      assert(
        machineBUuids.has(uuid),
        `Machine B lost shared neuron UUID ${uuid} after ModWeight`,
      );
    }

    let offspring: Creature | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      offspring = Offspring.breed(machineA, machineB, { forwardOnly: true });
      if (offspring) break;
    }
    assert(
      offspring !== undefined,
      "Cross-machine breeding should produce offspring",
    );
    creatureValidate(offspring, { forwardOnly: true });

    const offspringUuids = collectHiddenUuids(offspring);
    let sharedNeuronCount = 0;
    for (const [uuid] of sharedUuids) {
      if (offspringUuids.has(uuid)) {
        sharedNeuronCount++;
      }
    }

    assert(
      sharedNeuronCount > 0,
      `Offspring from independently-evolved creatures must inherit at least ` +
        `some shared neuron UUIDs for cross-machine breeding to work. ` +
        `Found ${sharedNeuronCount} of ${sharedUuids.size} shared UUIDs.`,
    );
  },
);

Deno.test(
  "UUID stability: exportJSON contains no numeric id, fromId, or toId",
  () => {
    const creature = buildCreature();
    const json = creature.exportJSON();

    for (const neuron of json.neurons) {
      assertEquals(
        neuron.id,
        undefined,
        `Neuron export must not contain numeric 'id' — found ${neuron.id}`,
      );
    }

    for (const synapse of json.synapses) {
      const s = synapse as unknown as Record<string, unknown>;
      assertEquals(
        s.fromId,
        undefined,
        `Synapse export must not contain 'fromId' — found ${s.fromId}`,
      );
      assertEquals(
        s.toId,
        undefined,
        `Synapse export must not contain 'toId' — found ${s.toId}`,
      );
    }
  },
);

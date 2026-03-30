/**
 * Quality gate test: semanticVersion MUST survive every pipeline operation.
 *
 * Once a creature is 4.x, nothing — mutation, breeding, compaction, discovery
 * application, or export/import — may drop, reset, or downgrade its version.
 * Upgrade is a one-time load-from-disk operation that should never fire again.
 *
 * This test enforces the invariant described in AGENTS.md under
 * "Semantic version is immutable after upgrade (CRITICAL INVARIANT)".
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Offspring } from "../../src/architecture/Offspring.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import { Mutation } from "../../src/NEAT/Mutation.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { AddNeuron } from "../../src/mutate/AddNeuron.ts";
import { AddConnection } from "../../src/mutate/AddConnection.ts";
import { ModWeight } from "../../src/mutate/ModWeight.ts";
import { ModBias } from "../../src/mutate/ModBias.ts";
import { SubConnection } from "../../src/mutate/SubConnection.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

const EXPECTED_VERSION = "4.0.0";

function buildCreature(): Creature {
  return Creature.fromJSON({
    neurons: [
      { type: "hidden", squash: "LOGISTIC", bias: 0.1, uuid: "sv-aaaa-1111" },
      { type: "hidden", squash: "TANH", bias: -0.2, uuid: "sv-bbbb-2222" },
      { type: "hidden", squash: "RELU", bias: 0.3, uuid: "sv-cccc-3333" },
      { type: "output", squash: "IDENTITY", bias: 0.0, uuid: "output-0" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "sv-aaaa-1111", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "sv-bbbb-2222", weight: 0.8 },
      { fromUUID: "sv-aaaa-1111", toUUID: "sv-cccc-3333", weight: 0.5 },
      { fromUUID: "sv-bbbb-2222", toUUID: "sv-cccc-3333", weight: -0.3 },
      { fromUUID: "sv-cccc-3333", toUUID: "output-0", weight: 0.9 },
    ],
    input: 2,
    output: 1,
    semanticVersion: EXPECTED_VERSION,
  });
}

Deno.test(
  "semanticVersion preserved: new creature defaults to 4.0.0",
  () => {
    const creature = new Creature(2, 1);
    assertEquals(creature.semanticVersion, EXPECTED_VERSION);
  },
);

Deno.test(
  "semanticVersion preserved: fromJSON round-trip",
  () => {
    const creature = buildCreature();
    assertEquals(creature.semanticVersion, EXPECTED_VERSION);

    const json = creature.exportJSON();
    assertEquals(json.semanticVersion, EXPECTED_VERSION);

    const restored = Creature.fromJSON(json);
    assertEquals(restored.semanticVersion, EXPECTED_VERSION);
  },
);

Deno.test(
  "semanticVersion preserved: after AddNeuron mutation",
  () => {
    const creature = buildCreature();
    assertEquals(creature.semanticVersion, EXPECTED_VERSION);

    const addNeuron = new AddNeuron(creature);
    addNeuron.mutate();

    assertEquals(
      creature.semanticVersion,
      EXPECTED_VERSION,
      "AddNeuron must not change semanticVersion",
    );
  },
);

Deno.test(
  "semanticVersion preserved: after AddConnection mutation",
  () => {
    const creature = buildCreature();
    assertEquals(creature.semanticVersion, EXPECTED_VERSION);

    const addConn = new AddConnection(creature);
    addConn.mutate();

    assertEquals(
      creature.semanticVersion,
      EXPECTED_VERSION,
      "AddConnection must not change semanticVersion",
    );
  },
);

Deno.test(
  "semanticVersion preserved: after ModWeight mutation",
  () => {
    const creature = buildCreature();
    assertEquals(creature.semanticVersion, EXPECTED_VERSION);

    const modWeight = new ModWeight(creature);
    modWeight.mutate();

    assertEquals(
      creature.semanticVersion,
      EXPECTED_VERSION,
      "ModWeight must not change semanticVersion",
    );
  },
);

Deno.test(
  "semanticVersion preserved: after ModBias mutation",
  () => {
    const creature = buildCreature();
    assertEquals(creature.semanticVersion, EXPECTED_VERSION);

    const modBias = new ModBias(creature);
    modBias.mutate();

    assertEquals(
      creature.semanticVersion,
      EXPECTED_VERSION,
      "ModBias must not change semanticVersion",
    );
  },
);

Deno.test(
  "semanticVersion preserved: after SubConnection mutation",
  () => {
    const creature = buildCreature();
    assertEquals(creature.semanticVersion, EXPECTED_VERSION);

    const subConn = new SubConnection(creature);
    subConn.mutate();

    assertEquals(
      creature.semanticVersion,
      EXPECTED_VERSION,
      "SubConnection must not change semanticVersion",
    );
  },
);

Deno.test(
  "semanticVersion preserved: after Mutator.mutate (multiple generations)",
  () => {
    const creature = buildCreature();
    creature.forwardOnly = true;

    assertEquals(creature.semanticVersion, EXPECTED_VERSION);

    const config = createNeatConfig({
      mutation: [
        Mutation.ADD_NODE,
        Mutation.ADD_CONN,
        Mutation.MOD_WEIGHT,
        Mutation.MOD_BIAS,
      ],
      mutationRate: 1,
      mutationAmount: 2,
    });
    const mutator = new Mutator(config);

    for (let gen = 0; gen < 5; gen++) {
      mutator.mutate([creature]);
      assertEquals(
        creature.semanticVersion,
        EXPECTED_VERSION,
        `semanticVersion changed after generation ${gen + 1}`,
      );
    }
  },
);

Deno.test(
  "semanticVersion preserved: breeding offspring inherits 4.x",
  () => {
    const mother = buildCreature();
    mother.forwardOnly = true;
    assertEquals(mother.semanticVersion, EXPECTED_VERSION);

    const father = buildCreature();
    father.forwardOnly = true;

    const addNeuron = new AddNeuron(father);
    addNeuron.mutate();

    const addConn = new AddConnection(father);
    addConn.mutate();

    assertEquals(father.semanticVersion, EXPECTED_VERSION);

    let offspring: Creature | undefined;
    for (let attempt = 0; attempt < 50 && !offspring; attempt++) {
      offspring = Offspring.breed(mother, father, {
        forwardOnly: true,
      });
    }
    assert(offspring, "Breeding should produce offspring");
    assertEquals(
      offspring.semanticVersion,
      EXPECTED_VERSION,
      "Offspring must inherit 4.x semanticVersion",
    );
  },
);

Deno.test(
  "semanticVersion preserved: exportJSON never drops version",
  () => {
    const creature = buildCreature();
    const json = creature.exportJSON();

    assert(
      json.semanticVersion !== undefined,
      "exportJSON must include semanticVersion",
    );
    assertEquals(json.semanticVersion, EXPECTED_VERSION);
  },
);

Deno.test(
  "semanticVersion preserved: shallowClone",
  () => {
    const creature = buildCreature();
    assertEquals(creature.semanticVersion, EXPECTED_VERSION);

    const clone = creature.shallowClone();
    assertEquals(
      clone.semanticVersion,
      EXPECTED_VERSION,
      "shallowClone must preserve semanticVersion",
    );
  },
);

Deno.test(
  "semanticVersion preserved: mutation + export + reimport cycle",
  () => {
    const creature = buildCreature();
    creature.forwardOnly = true;

    for (let cycle = 0; cycle < 3; cycle++) {
      const addNeuron = new AddNeuron(creature);
      addNeuron.mutate();

      const json = creature.exportJSON();
      assertEquals(
        json.semanticVersion,
        EXPECTED_VERSION,
        `Version lost after mutation cycle ${cycle + 1} export`,
      );

      const reimported = Creature.fromJSON(json);
      assertEquals(
        reimported.semanticVersion,
        EXPECTED_VERSION,
        `Version lost after mutation cycle ${cycle + 1} reimport`,
      );
    }
  },
);

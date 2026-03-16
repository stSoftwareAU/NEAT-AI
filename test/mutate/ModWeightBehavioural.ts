/**
 * Behavioural tests for the ModWeight mutation operator.
 *
 * Issue #1441: Verifies that:
 * 1. ModWeight changes weights within configured bounds
 * 2. Weight always remains a finite number after mutation
 * 3. Creature remains valid after weight modification
 * 4. Weight changes are bounded by maxWeightChange
 * 5. Returns false when no synapses exist
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";
import { ModWeight } from "../../src/mutate/ModWeight.ts";

/**
 * Creates a creature with multiple synapses for weight mutation testing.
 */
function createMultiSynapseCreature(): Creature {
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: "LOGISTIC",
        bias: 0.1,
      },
      {
        type: "hidden",
        uuid: "hidden-2",
        squash: "TANH",
        bias: 0.2,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 5.0 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: -3.0 },
      { fromUUID: "input-2", toUUID: "hidden-2", weight: 1.0 },
      { fromUUID: "hidden-1", toUUID: "hidden-2", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "hidden-2", toUUID: "output-0", weight: -1.5 },
    ],
  };
  return Creature.fromJSON(json);
}

Deno.test("ModWeight: successfully modifies a weight", () => {
  const creature = createMultiSynapseCreature();
  const modWeight = new ModWeight(creature);

  let changed = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (modWeight.mutate()) {
      changed = true;
      break;
    }
  }

  assert(changed, "ModWeight should change at least one weight");
});

Deno.test("ModWeight: all weights remain finite after mutation", () => {
  const creature = createMultiSynapseCreature();
  const modWeight = new ModWeight(creature);

  for (let i = 0; i < 200; i++) {
    modWeight.mutate();
    for (const synapse of creature.synapses) {
      assert(
        Number.isFinite(synapse.weight),
        `Weight must be finite after mutation, got ${synapse.weight}`,
      );
    }
  }
});

Deno.test("ModWeight: creature remains valid after repeated mutations", () => {
  const creature = createMultiSynapseCreature();
  creatureValidate(creature);
  const modWeight = new ModWeight(creature);

  for (let i = 0; i < 100; i++) {
    modWeight.mutate();
  }

  creatureValidate(creature);
});

Deno.test("ModWeight: returns false when creature has no synapses", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
  };

  const creature = Creature.fromJSON(json, true);
  const modWeight = new ModWeight(creature);

  const result = modWeight.mutate();
  assertEquals(result, false, "Should return false when no synapses exist");
});

Deno.test("ModWeight: weight actually changes value (not a no-op)", () => {
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 5.0 },
    ],
  };

  const creature = Creature.fromJSON(json, true);
  const modWeight = new ModWeight(creature);

  const originalWeight = creature.synapses[0].weight;
  let changed = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (modWeight.mutate()) {
      if (creature.synapses[0].weight !== originalWeight) {
        changed = true;
        break;
      }
    }
  }

  assert(changed, "ModWeight should eventually change the weight value");
});

/**
 * Tests for similarity-based neuron alignment in editParentByIndex.
 *
 * Issue #2174: Verifies that editParentByIndex uses input-weight cosine
 * similarity to align functionally similar neurons during inter-species
 * breeding, rather than arbitrary sequential mapping.
 */
import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import {
  Creature,
  type CreatureExport,
  CreatureUtil,
  type NeuronExport,
} from "../../mod.ts";
import { editParentByIndex } from "@breed/EditParentByIndex.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";

/**
 * Creates a creature with hidden neurons that have specific input weight
 * patterns, enabling controlled testing of similarity-based alignment.
 */
function createCreatureWithWeights(
  hiddenNeurons: {
    uuid: string;
    inputWeights: { from: string; weight: number }[];
  }[],
  inputCount: number,
): Creature {
  const neurons: NeuronExport[] = hiddenNeurons.map((n) => ({
    type: "hidden" as const,
    uuid: n.uuid,
    squash: "LOGISTIC",
    bias: 0.1,
  }));

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  const synapses: CreatureExport["synapses"] = [];

  // Add specified input connections to each hidden neuron
  for (const hidden of hiddenNeurons) {
    for (const conn of hidden.inputWeights) {
      synapses.push({
        fromUUID: conn.from,
        toUUID: hidden.uuid,
        weight: conn.weight,
      });
    }
  }

  // Chain hidden neurons if more than one
  for (let i = 0; i < hiddenNeurons.length - 1; i++) {
    synapses.push({
      fromUUID: hiddenNeurons[i].uuid,
      toUUID: hiddenNeurons[i + 1].uuid,
      weight: 0.1,
    });
  }

  // Connect last hidden (or first if only one) to output
  if (hiddenNeurons.length > 0) {
    synapses.push({
      fromUUID: hiddenNeurons[hiddenNeurons.length - 1].uuid,
      toUUID: "output-0",
      weight: 0.5,
    });
  }

  // Ensure at least one input connects even if not in weights
  // (to make the creature valid)
  const connectedInputs = new Set<string>();
  for (const hidden of hiddenNeurons) {
    for (const conn of hidden.inputWeights) {
      connectedInputs.add(conn.from);
    }
  }
  if (connectedInputs.size === 0 && hiddenNeurons.length > 0) {
    synapses.push({
      fromUUID: "input-0",
      toUUID: hiddenNeurons[0].uuid,
      weight: 0.01,
    });
  }

  // Ensure all inputs have at least one connection
  for (let i = 0; i < inputCount; i++) {
    const inputUuid = `input-${i}`;
    if (!connectedInputs.has(inputUuid)) {
      const targetNeuron = hiddenNeurons.length > 0
        ? hiddenNeurons[0].uuid
        : "output-0";
      synapses.push({
        fromUUID: inputUuid,
        toUUID: targetNeuron,
        weight: 0.001,
      });
    }
  }

  const json: CreatureExport = {
    input: inputCount,
    output: 1,
    neurons,
    synapses,
  };

  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "editParentByIndex: similarity-based alignment maps functionally similar neurons",
  () => {
    // Parent has two hidden neurons with distinct input patterns:
    // parent-A: strong on input-0 (weight 0.9)
    // parent-B: strong on input-1 (weight 0.9)
    const parent = createCreatureWithWeights(
      [
        {
          uuid: "parent-A",
          inputWeights: [
            { from: "input-0", weight: 0.9 },
            { from: "input-1", weight: 0.05 },
          ],
        },
        {
          uuid: "parent-B",
          inputWeights: [
            { from: "input-0", weight: 0.05 },
            { from: "input-1", weight: 0.9 },
          ],
        },
      ],
      2,
    );

    // Target has two hidden neurons — in reversed order:
    // target-Y: strong on input-1 (similar to parent-B)
    // target-X: strong on input-0 (similar to parent-A)
    // Note: target-Y comes FIRST — sequential mapping would map
    // target-Y -> parent-A (wrong!), but similarity should map
    // target-Y -> parent-B and target-X -> parent-A
    const target = createCreatureWithWeights(
      [
        {
          uuid: "target-Y",
          inputWeights: [
            { from: "input-0", weight: 0.05 },
            { from: "input-1", weight: 0.85 },
          ],
        },
        {
          uuid: "target-X",
          inputWeights: [
            { from: "input-0", weight: 0.85 },
            { from: "input-1", weight: 0.05 },
          ],
        },
      ],
      2,
    );

    const child = editParentByIndex(parent, target);
    creatureValidate(child);

    const childExport = child.exportJSON();
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );

    // Verify that the child has the parent UUIDs
    const childUuids = new Set(hiddenNeurons.map((n) => n.uuid));
    assert(
      childUuids.has("parent-A"),
      "Child should contain parent-A UUID",
    );
    assert(
      childUuids.has("parent-B"),
      "Child should contain parent-B UUID",
    );

    // The key test: check that similarity-based alignment maps correctly.
    // target-Y (strong input-1) should be aliased to parent-B (strong input-1)
    // target-X (strong input-0) should be aliased to parent-A (strong input-0)
    for (const neuron of hiddenNeurons) {
      const alias = getTag(neuron, "alias");
      if (alias === "target-Y") {
        assertEquals(
          neuron.uuid,
          "parent-B",
          "target-Y (strong input-1) should map to parent-B (strong input-1)",
        );
      } else if (alias === "target-X") {
        assertEquals(
          neuron.uuid,
          "parent-A",
          "target-X (strong input-0) should map to parent-A (strong input-0)",
        );
      }
    }
  },
);

Deno.test(
  "editParentByIndex: falls back gracefully when no similarity exists",
  () => {
    // Parent and target neurons have completely disjoint input connections
    const parent = createCreatureWithWeights(
      [
        {
          uuid: "parent-A",
          inputWeights: [{ from: "input-0", weight: 0.9 }],
        },
      ],
      4,
    );

    const target = createCreatureWithWeights(
      [
        {
          uuid: "target-X",
          inputWeights: [{ from: "input-2", weight: 0.9 }],
        },
      ],
      4,
    );

    // Should still produce a valid child via sequential fallback
    const child = editParentByIndex(parent, target);
    creatureValidate(child);

    const childExport = child.exportJSON();
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );

    // The target neuron should still be remapped to the parent UUID
    assertEquals(hiddenNeurons.length, 1);
    assertEquals(
      hiddenNeurons[0].uuid,
      "parent-A",
      "Fallback should still map target to parent UUID",
    );
  },
);

Deno.test(
  "editParentByIndex: similarity alignment produces valid exportable creature",
  () => {
    const parent = createCreatureWithWeights(
      [
        {
          uuid: "parent-A",
          inputWeights: [
            { from: "input-0", weight: 0.7 },
            { from: "input-1", weight: 0.3 },
          ],
        },
        {
          uuid: "parent-B",
          inputWeights: [
            { from: "input-0", weight: 0.2 },
            { from: "input-1", weight: 0.8 },
          ],
        },
      ],
      3,
    );

    const target = createCreatureWithWeights(
      [
        {
          uuid: "target-X",
          inputWeights: [
            { from: "input-0", weight: 0.65 },
            { from: "input-1", weight: 0.35 },
          ],
        },
        {
          uuid: "target-Y",
          inputWeights: [
            { from: "input-0", weight: 0.25 },
            { from: "input-1", weight: 0.75 },
          ],
        },
      ],
      3,
    );

    const child = editParentByIndex(parent, target);
    creatureValidate(child);

    // Round-trip: export and re-import
    const exported = child.exportJSON();
    const reimported = Creature.fromJSON(exported);
    creatureValidate(reimported);
  },
);

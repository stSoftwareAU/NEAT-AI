/**
 * Tests for the editParentByIndex function.
 *
 * Issue #1485: Verifies that:
 * 1. Index-based parent editing produces valid creatures
 * 2. Non-matching hidden neurons are remapped to parent neuron UUIDs
 * 3. Synapses are updated to reflect UUID changes
 * 4. Original parent and target are not modified (no side effects)
 * 5. Boundary conditions: no hidden neurons, all neurons matching, disjoint neurons
 * 6. Grafting tags are applied correctly
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import {
  Creature,
  type CreatureExport,
  CreatureUtil,
  type NeuronExport,
} from "../../mod.ts";
import { editParentByIndex } from "../../src/breed/EditParentByIndex.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

/**
 * Creates a creature with specified hidden neuron UUIDs for controlled testing.
 */
function createCreatureWithHidden(
  hiddenUUIDs: string[],
  inputCount: number,
  outputCount: number,
): Creature {
  const neurons: NeuronExport[] = hiddenUUIDs.map((uuid) => ({
    type: "hidden" as const,
    uuid: uuid,
    squash: "LOGISTIC",
    bias: 0.1,
  }));

  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  const synapses: CreatureExport["synapses"] = [];

  // Connect inputs to first hidden neuron (or directly to outputs if no hidden)
  if (hiddenUUIDs.length > 0) {
    for (let i = 0; i < inputCount; i++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: hiddenUUIDs[0],
        weight: 0.5,
      });
    }

    // Chain hidden neurons
    for (let i = 0; i < hiddenUUIDs.length - 1; i++) {
      synapses.push({
        fromUUID: hiddenUUIDs[i],
        toUUID: hiddenUUIDs[i + 1],
        weight: 0.3,
      });
    }

    // Connect last hidden to all outputs
    const lastHidden = hiddenUUIDs[hiddenUUIDs.length - 1];
    for (let i = 0; i < outputCount; i++) {
      synapses.push({
        fromUUID: lastHidden,
        toUUID: `output-${i}`,
        weight: 0.8,
      });
    }
  } else {
    // Direct input-to-output connections
    for (let i = 0; i < inputCount; i++) {
      for (let j = 0; j < outputCount; j++) {
        synapses.push({
          fromUUID: `input-${i}`,
          toUUID: `output-${j}`,
          weight: 0.5,
        });
      }
    }
  }

  const json: CreatureExport = {
    input: inputCount,
    output: outputCount,
    neurons: neurons,
    synapses: synapses,
  };

  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "editParentByIndex: remaps non-matching hidden neurons to parent UUIDs",
  () => {
    const parent = createCreatureWithHidden(["parent-h1", "parent-h2"], 2, 1);
    const target = createCreatureWithHidden(["target-h1", "target-h2"], 2, 1);

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    assertEquals(child.input, 2, "Input count preserved");
    assertEquals(child.output, 1, "Output count preserved");
  },
);

Deno.test(
  "editParentByIndex: produces a valid creature",
  () => {
    const parent = createCreatureWithHidden(["parent-a"], 2, 1);
    const target = createCreatureWithHidden(["target-a"], 2, 1);

    const child = editParentByIndex(parent, target);

    // The child should pass validation
    creatureValidate(child);

    // Should be exportable and re-importable
    const exported = child.exportJSON();
    const reimported = Creature.fromJSON(exported);
    creatureValidate(reimported);
  },
);

Deno.test(
  "editParentByIndex: does not modify original parent",
  () => {
    const parent = createCreatureWithHidden(["parent-orig1"], 2, 1);
    const parentExportBefore = JSON.stringify(parent.exportJSON());

    const target = createCreatureWithHidden(["target-orig1"], 2, 1);

    editParentByIndex(parent, target);

    const parentExportAfter = JSON.stringify(parent.exportJSON());
    assertEquals(
      parentExportBefore,
      parentExportAfter,
      "Parent should not be modified by editParentByIndex",
    );
  },
);

Deno.test(
  "editParentByIndex: does not modify original target",
  () => {
    const parent = createCreatureWithHidden(["parent-orig2"], 2, 1);
    const target = createCreatureWithHidden(["target-orig2"], 2, 1);
    const targetExportBefore = JSON.stringify(target.exportJSON());

    editParentByIndex(parent, target);

    const targetExportAfter = JSON.stringify(target.exportJSON());
    assertEquals(
      targetExportBefore,
      targetExportAfter,
      "Target should not be modified by editParentByIndex",
    );
  },
);

Deno.test(
  "editParentByIndex: matching hidden neurons are preserved",
  () => {
    // Both parent and target share the same hidden neuron UUID
    const sharedUUID = "shared-hidden-1";
    const parent = createCreatureWithHidden([sharedUUID], 2, 1);
    const target = createCreatureWithHidden([sharedUUID], 2, 1);

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    // The shared neuron should remain with its original UUID
    const childExport = child.exportJSON();
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );
    assert(hiddenNeurons.length > 0, "Should have hidden neurons");
    assertEquals(
      hiddenNeurons[0].uuid,
      sharedUUID,
      "Shared hidden neuron UUID should be preserved",
    );
  },
);

Deno.test(
  "editParentByIndex: grafting tags are applied to remapped neurons",
  () => {
    const parent = createCreatureWithHidden(["parent-tag1"], 2, 1);
    const target = createCreatureWithHidden(["target-tag1"], 2, 1);

    const child = editParentByIndex(parent, target);
    const childExport = child.exportJSON();

    // Find the remapped hidden neuron
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );

    // The target neuron "target-tag1" should have been remapped to "parent-tag1"
    // and tagged with alias and approach
    let foundGraft = false;
    for (const neuron of hiddenNeurons) {
      const approach = getTag(neuron, "approach");
      if (approach === "graft") {
        foundGraft = true;
        const alias = getTag(neuron, "alias");
        assert(alias, "Grafted neuron should have an alias tag");
        assertEquals(
          alias,
          "target-tag1",
          "Alias should reference the original target UUID",
        );
        assertEquals(
          neuron.uuid,
          "parent-tag1",
          "UUID should be remapped to parent's hidden neuron UUID",
        );
      }
    }

    assert(foundGraft, "Should find at least one grafted neuron");
  },
);

Deno.test(
  "editParentByIndex: synapses are updated after UUID remapping",
  () => {
    const parent = createCreatureWithHidden(["parent-syn1"], 2, 1);
    const target = createCreatureWithHidden(["target-syn1"], 2, 1);

    const child = editParentByIndex(parent, target);
    const childExport = child.exportJSON();

    // After remapping, synapses should reference the new UUID
    // The target's "target-syn1" should now be "parent-syn1"
    for (const synapse of childExport.synapses) {
      assertNotEquals(
        synapse.fromUUID,
        "target-syn1",
        "Synapses should not reference the old target UUID in fromUUID",
      );
      assertNotEquals(
        synapse.toUUID,
        "target-syn1",
        "Synapses should not reference the old target UUID in toUUID",
      );
    }
  },
);

Deno.test(
  "editParentByIndex: creatures with no hidden neurons return valid child",
  () => {
    const parent = createCreatureWithHidden([], 2, 1);
    const target = createCreatureWithHidden([], 2, 1);

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    assertEquals(child.input, 2, "Input count preserved");
    assertEquals(child.output, 1, "Output count preserved");
  },
);

Deno.test(
  "editParentByIndex: multiple hidden neurons are remapped sequentially",
  () => {
    const parent = createCreatureWithHidden(
      ["parent-m1", "parent-m2", "parent-m3"],
      2,
      1,
    );
    const target = createCreatureWithHidden(
      ["target-m1", "target-m2", "target-m3"],
      2,
      1,
    );

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    const childExport = child.exportJSON();
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );

    // All hidden neurons should have been remapped
    for (const neuron of hiddenNeurons) {
      // None of the original target UUIDs should remain
      assert(
        !neuron.uuid.startsWith("target-"),
        `Hidden neuron UUID ${neuron.uuid} should have been remapped from target`,
      );
    }
  },
);

Deno.test(
  "editParentByIndex: partial overlap preserves matching, remaps non-matching",
  () => {
    // Parent has hidden neurons ["shared-1", "parent-only"]
    // Target has hidden neurons ["shared-1", "target-only"]
    // "shared-1" should be preserved, "target-only" should be remapped to "parent-only"
    const parent = createCreatureWithHidden(
      ["shared-1", "parent-only"],
      2,
      1,
    );
    const target = createCreatureWithHidden(
      ["shared-1", "target-only"],
      2,
      1,
    );

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    const childExport = child.exportJSON();
    const hiddenUUIDs = childExport.neurons
      .filter((n) => n.type === "hidden")
      .map((n) => n.uuid);

    // "shared-1" should be preserved
    assert(
      hiddenUUIDs.includes("shared-1"),
      "Shared neuron UUID should be preserved",
    );

    // "target-only" should have been remapped to "parent-only"
    assert(
      !hiddenUUIDs.includes("target-only"),
      "Non-matching target neuron should have been remapped",
    );
    assert(
      hiddenUUIDs.includes("parent-only"),
      "Should be remapped to parent's non-matching neuron UUID",
    );
  },
);

Deno.test(
  "editParentByIndex: works with multi-output creatures",
  () => {
    const parent = createCreatureWithHidden(["parent-mo1"], 3, 2);
    const target = createCreatureWithHidden(["target-mo1"], 3, 2);

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    assertEquals(child.input, 3, "Input count preserved");
    assertEquals(child.output, 2, "Output count preserved");
  },
);

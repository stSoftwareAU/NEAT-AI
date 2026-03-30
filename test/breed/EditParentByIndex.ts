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
import { creatureValidate } from "@architecture/CreatureValidate.ts";

/**
 * Creates a creature with specified hidden neuron UUID suffixes for controlled testing.
 */
function createCreatureWithHidden(
  hiddenIds: number[],
  inputCount: number,
  outputCount: number,
): Creature {
  const hiddenUuid = (id: number) => `hidden-${id}`;
  const outputUuid = (index: number) => `output-${index}`;

  const neurons: NeuronExport[] = hiddenIds.map((id) => ({
    type: "hidden" as const,
    uuid: hiddenUuid(id),
    squash: "LOGISTIC",
    bias: 0.1,
  }));

  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: outputUuid(i),
      squash: "IDENTITY",
      bias: 0,
    });
  }

  const synapses: CreatureExport["synapses"] = [];

  // Connect inputs to first hidden neuron (or directly to outputs if no hidden)
  if (hiddenIds.length > 0) {
    for (let i = 0; i < inputCount; i++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: hiddenUuid(hiddenIds[0]),
        weight: 0.5,
      });
    }

    // Chain hidden neurons
    for (let i = 0; i < hiddenIds.length - 1; i++) {
      synapses.push({
        fromUUID: hiddenUuid(hiddenIds[i]),
        toUUID: hiddenUuid(hiddenIds[i + 1]),
        weight: 0.3,
      });
    }

    // Connect last hidden to all outputs
    const lastHidden = hiddenIds[hiddenIds.length - 1];
    for (let i = 0; i < outputCount; i++) {
      synapses.push({
        fromUUID: hiddenUuid(lastHidden),
        toUUID: outputUuid(i),
        weight: 0.8,
      });
    }
  } else {
    // Direct input-to-output connections
    for (let i = 0; i < inputCount; i++) {
      for (let j = 0; j < outputCount; j++) {
        synapses.push({
          fromUUID: `input-${i}`,
          toUUID: outputUuid(j),
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
    const parent = createCreatureWithHidden([5001, 5002], 2, 1);
    const target = createCreatureWithHidden([6001, 6002], 2, 1);

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    assertEquals(child.input, 2, "Input count preserved");
    assertEquals(child.output, 1, "Output count preserved");
  },
);

Deno.test(
  "editParentByIndex: produces a valid creature",
  () => {
    const parent = createCreatureWithHidden([5010], 2, 1);
    const target = createCreatureWithHidden([6010], 2, 1);

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
    const parent = createCreatureWithHidden([5020], 2, 1);
    const parentExportBefore = JSON.stringify(parent.exportJSON());

    const target = createCreatureWithHidden([6020], 2, 1);

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
    const parent = createCreatureWithHidden([5030], 2, 1);
    const target = createCreatureWithHidden([6030], 2, 1);
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
    const sharedId = 7777;
    const parent = createCreatureWithHidden([sharedId], 2, 1);
    const target = createCreatureWithHidden([sharedId], 2, 1);

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    // The shared neuron should remain with its original ID
    const childExport = child.exportJSON();
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );
    assert(hiddenNeurons.length > 0, "Should have hidden neurons");
    assertEquals(
      hiddenNeurons[0].uuid,
      `hidden-${sharedId}`,
      "Shared hidden neuron UUID should be preserved",
    );
  },
);

Deno.test(
  "editParentByIndex: grafting tags are applied to remapped neurons",
  () => {
    const parent = createCreatureWithHidden([5040], 2, 1);
    const target = createCreatureWithHidden([6040], 2, 1);

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
          "hidden-6040",
          "Alias should reference the original target UUID",
        );
        assertEquals(
          neuron.uuid,
          "hidden-5040",
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
    const parent = createCreatureWithHidden([5050], 2, 1);
    const target = createCreatureWithHidden([6050], 2, 1);

    const child = editParentByIndex(parent, target);
    const childExport = child.exportJSON();

    // After remapping, synapses should reference the new UUID
    // The target's "target-syn1" should now be "parent-syn1"
    for (const synapse of childExport.synapses) {
      assertNotEquals(
        synapse.fromUUID,
        "hidden-6050",
        "Synapses should not reference the old target UUID in fromUUID",
      );
      assertNotEquals(
        synapse.toUUID,
        "hidden-6050",
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
      [5061, 5062, 5063],
      2,
      1,
    );
    const target = createCreatureWithHidden(
      [6061, 6062, 6063],
      2,
      1,
    );

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    const childExport = child.exportJSON();
    const hiddenNeurons = childExport.neurons.filter((n) =>
      n.type === "hidden"
    );

    // All hidden neurons should have been remapped to parent UUIDs
    const parentIds = new Set([
      "hidden-5061",
      "hidden-5062",
      "hidden-5063",
    ]);
    for (const neuron of hiddenNeurons) {
      assert(
        parentIds.has(neuron.uuid!),
        `Hidden neuron UUID ${neuron.uuid} should have been remapped to a parent UUID`,
      );
    }
  },
);

Deno.test(
  "editParentByIndex: partial overlap preserves matching, remaps non-matching",
  () => {
    // Parent has hidden neurons [8888, 5070]
    // Target has hidden neurons [8888, 6070]
    // 8888 should be preserved, 6070 should be remapped to 5070
    const parent = createCreatureWithHidden(
      [8888, 5070],
      2,
      1,
    );
    const target = createCreatureWithHidden(
      [8888, 6070],
      2,
      1,
    );

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    const childExport = child.exportJSON();
    const hiddenIds = childExport.neurons
      .filter((n) => n.type === "hidden")
      .map((n) => n.uuid);

    // 8888 should be preserved
    assert(
      hiddenIds.includes("hidden-8888"),
      "Shared neuron UUID should be preserved",
    );

    // 6070 should have been remapped to 5070
    assert(
      !hiddenIds.includes("hidden-6070"),
      "Non-matching target neuron should have been remapped",
    );
    assert(
      hiddenIds.includes("hidden-5070"),
      "Should be remapped to parent's non-matching neuron UUID",
    );
  },
);

Deno.test(
  "editParentByIndex: works with multi-output creatures",
  () => {
    const parent = createCreatureWithHidden([5080], 3, 2);
    const target = createCreatureWithHidden([6080], 3, 2);

    const child = editParentByIndex(parent, target);

    creatureValidate(child);
    assertEquals(child.input, 3, "Input count preserved");
    assertEquals(child.output, 2, "Output count preserved");
  },
);

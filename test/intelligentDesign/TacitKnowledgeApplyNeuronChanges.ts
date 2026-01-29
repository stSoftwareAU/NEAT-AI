/**
 * Tests for `applyNeuronChanges()`.
 *
 * We stub `Creature.scoreDir()` to avoid needing a dataset on disk while still
 * validating that neuron squashes and tags are applied correctly.
 */

import { assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { applyNeuronChanges } from "../../src/intelligentDesign/TacitKnowledge.ts";

Deno.test("applyNeuronChanges updates neuron squashes, tags changes, and tags score/error", async () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  try {
    Creature.prototype.scoreDir = function () {
      return Promise.resolve({ score: 9.9, error: 0.01 } as const);
    };

    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const exported = creature.exportJSON();
    const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
    assertEquals(hiddenNeurons.length > 0, true);

    const first = hiddenNeurons[0];
    const second = hiddenNeurons.length > 1
      ? hiddenNeurons[1]
      : hiddenNeurons[0];
    assertExists(first.uuid);
    assertExists(second.uuid);

    // Ensure one change and one no-op to cover the "continue" branch.
    first.squash = "TANH";
    second.squash = "GELU";

    const neuronSquashMap = new Map<
      string,
      { squash: string; score: number; error: number }
    >();
    neuronSquashMap.set(first.uuid, { squash: "Swish", score: 2, error: 1 });
    neuronSquashMap.set(second.uuid, { squash: "GELU", score: 2, error: 1 }); // unchanged

    const result = await applyNeuronChanges(exported, neuronSquashMap, ".", {});

    assertEquals(result.score, 9.9);
    assertEquals(result.error, 0.01);

    const updated = result.creature.neurons.find((n) => n.uuid === first.uuid);
    assertExists(updated);
    assertEquals(updated.squash, "Swish");

    const tag = updated.tags?.find((t) => t.name === "intelligentDesign");
    assertExists(tag);
    assertEquals(tag.value, "TANH -> Swish");

    const scoreTag = result.creature.tags?.find((t) => t.name === "score");
    const errorTag = result.creature.tags?.find((t) => t.name === "error");
    assertExists(scoreTag);
    assertExists(errorTag);
    assertEquals(scoreTag.value, "9.9");
    assertEquals(errorTag.value, "0.01");
  } finally {
    Creature.prototype.scoreDir = originalScoreDir;
  }
});

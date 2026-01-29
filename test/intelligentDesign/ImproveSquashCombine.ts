/**
 * Tests for `combineImprovements()`.
 *
 * We stub `Creature.scoreDir()` to avoid dependence on dataset files while still
 * exercising the combination and fallback logic.
 */

import { assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { combineImprovements } from "../../src/intelligentDesign/ImproveSquash.ts";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

const TEST_DIR = ".test-intelligent-design-combine";

function cleanup() {
  try {
    Deno.removeSync(TEST_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors.
  }
}

Deno.test("combineImprovements returns original creature when no improvements exist", async () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exported = creature.exportJSON();

  const result = await combineImprovements(exported, new Map(), ".", 1.0);
  assertEquals(result.creature, exported);
  assertEquals(result.message, "No improvements found.");
});

Deno.test("combineImprovements returns the single improvement file contents", async () => {
  cleanup();
  try {
    await Deno.mkdir(TEST_DIR, { recursive: true });

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const exported = creature.exportJSON();

    const path = `${TEST_DIR}/one.json`;
    await Deno.writeTextFile(path, JSON.stringify(exported, null, 1));

    const improvements = new Map<
      string,
      { squash: string; score: number; path: string; message: string }
    >();
    improvements.set("neuron-uuid", {
      squash: "GELU",
      score: 2,
      path,
      message: "improved",
    });

    const result = await combineImprovements(exported, improvements, ".", 1.0);
    assertEquals(result.message, "improved");
    assertEquals(JSON.stringify(result.creature), JSON.stringify(exported));
  } finally {
    cleanup();
  }
});

Deno.test("combineImprovements returns combined creature when combined score beats best individual", async () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  cleanup();
  try {
    Creature.prototype.scoreDir = function () {
      return Promise.resolve({ score: 10, error: 0.1 } as const);
    };

    await Deno.mkdir(TEST_DIR, { recursive: true });

    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const exported = creature.exportJSON();
    const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
    assertEquals(hiddenNeurons.length > 1, true);
    const firstHidden = hiddenNeurons[0];
    const secondHidden = hiddenNeurons[1];
    assertExists(firstHidden.uuid);
    assertExists(secondHidden.uuid);

    const pathA = `${TEST_DIR}/a.json`;
    const pathB = `${TEST_DIR}/b.json`;
    await Deno.writeTextFile(pathA, JSON.stringify(exported, null, 1));
    await Deno.writeTextFile(pathB, JSON.stringify(exported, null, 1));

    const improvements = new Map<
      string,
      { squash: string; score: number; path: string; message: string }
    >();
    improvements.set(firstHidden.uuid, {
      squash: "GELU",
      score: 3,
      path: pathA,
      message: "A",
    });
    // Use a second neuron UUID to force the "combine" path (size > 1).
    improvements.set(secondHidden.uuid, {
      squash: "Swish",
      score: 4,
      path: pathB,
      message: "B",
    });

    const result = await combineImprovements(exported, improvements, ".", 1.0);
    assertEquals(typeof result.message, "string");

    const combined: CreatureExport = result.creature;
    const scoreTag = combined.tags?.find((t) => t.name === "score");
    const errorTag = combined.tags?.find((t) => t.name === "error");
    const idTag = combined.tags?.find((t) => t.name === "intelligentDesign");
    assertExists(scoreTag);
    assertExists(errorTag);
    assertExists(idTag);
    assertEquals(scoreTag.value, "10");
    assertEquals(errorTag.value, "0.1");
  } finally {
    Creature.prototype.scoreDir = originalScoreDir;
    cleanup();
  }
});

Deno.test("combineImprovements falls back to best individual when marriage fails", async () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  cleanup();
  try {
    Creature.prototype.scoreDir = function () {
      return Promise.resolve({ score: 4.5, error: 0.2 } as const);
    };

    await Deno.mkdir(TEST_DIR, { recursive: true });

    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const exported = creature.exportJSON();
    const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
    assertEquals(hiddenNeurons.length > 1, true);
    const firstHidden = hiddenNeurons[0];
    const secondHidden = hiddenNeurons[1];
    assertExists(firstHidden.uuid);
    assertExists(secondHidden.uuid);

    const pathA = `${TEST_DIR}/best.json`;
    const pathB = `${TEST_DIR}/worst.json`;
    await Deno.writeTextFile(pathA, JSON.stringify(exported, null, 1));
    await Deno.writeTextFile(pathB, JSON.stringify(exported, null, 1));

    const improvements = new Map<
      string,
      { squash: string; score: number; path: string; message: string }
    >();
    improvements.set(firstHidden.uuid, {
      squash: "GELU",
      score: 6,
      path: pathA,
      message: "best",
    });
    improvements.set(secondHidden.uuid, {
      squash: "Swish",
      score: 5,
      path: pathB,
      message: "worse",
    });

    const result = await combineImprovements(exported, improvements, ".", 1.0);
    assertEquals(result.message.includes("Marriage failed"), true);

    const fallbackCreature: CreatureExport = result.creature;
    const idTag = fallbackCreature.tags?.find((t) =>
      t.name === "intelligentDesign"
    );
    assertExists(idTag);
  } finally {
    Creature.prototype.scoreDir = originalScoreDir;
    cleanup();
  }
});

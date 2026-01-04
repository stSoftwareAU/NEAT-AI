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

Deno.test("combineImprovements returns original creature when no improvements exist", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exported = creature.exportJSON();

  const result = combineImprovements(exported, new Map(), ".", 1.0);
  assertEquals(result.creature, exported);
  assertEquals(result.message, "No improvements found.");
});

Deno.test("combineImprovements returns the single improvement file contents", () => {
  cleanup();
  try {
    Deno.mkdirSync(TEST_DIR, { recursive: true });

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const exported = creature.exportJSON();

    const path = `${TEST_DIR}/one.json`;
    Deno.writeTextFileSync(path, JSON.stringify(exported, null, 1));

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

    const result = combineImprovements(exported, improvements, ".", 1.0);
    assertEquals(result.message, "improved");
    assertEquals(JSON.stringify(result.creature), JSON.stringify(exported));
  } finally {
    cleanup();
  }
});

Deno.test("combineImprovements returns combined creature when combined score beats best individual", () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  cleanup();
  try {
    Creature.prototype.scoreDir = function () {
      return { score: 10, error: 0.1 } as const;
    };

    Deno.mkdirSync(TEST_DIR, { recursive: true });

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const exported = creature.exportJSON();
    const hidden = exported.neurons.find((n) => n.type === "hidden");
    assertExists(hidden?.uuid);

    const pathA = `${TEST_DIR}/a.json`;
    const pathB = `${TEST_DIR}/b.json`;
    Deno.writeTextFileSync(pathA, JSON.stringify(exported, null, 1));
    Deno.writeTextFileSync(pathB, JSON.stringify(exported, null, 1));

    const improvements = new Map<
      string,
      { squash: string; score: number; path: string; message: string }
    >();
    improvements.set(hidden.uuid, {
      squash: "GELU",
      score: 3,
      path: pathA,
      message: "A",
    });
    // Use a second key to force the "combine" path (size > 1).
    improvements.set(`${hidden.uuid}-2`, {
      squash: "Swish",
      score: 4,
      path: pathB,
      message: "B",
    });

    const result = combineImprovements(exported, improvements, ".", 1.0);
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

Deno.test("combineImprovements falls back to best individual when marriage fails", () => {
  const originalScoreDir = Creature.prototype.scoreDir;
  cleanup();
  try {
    Creature.prototype.scoreDir = function () {
      return { score: 4.5, error: 0.2 } as const;
    };

    Deno.mkdirSync(TEST_DIR, { recursive: true });

    const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
    const exported = creature.exportJSON();

    const pathA = `${TEST_DIR}/best.json`;
    const pathB = `${TEST_DIR}/worst.json`;
    Deno.writeTextFileSync(pathA, JSON.stringify(exported, null, 1));
    Deno.writeTextFileSync(pathB, JSON.stringify(exported, null, 1));

    const improvements = new Map<
      string,
      { squash: string; score: number; path: string; message: string }
    >();
    improvements.set("a", {
      squash: "GELU",
      score: 6,
      path: pathA,
      message: "best",
    });
    improvements.set("b", {
      squash: "Swish",
      score: 5,
      path: pathB,
      message: "worse",
    });

    const result = combineImprovements(exported, improvements, ".", 1.0);
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

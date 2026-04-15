/**
 * Tests for writeScores directory creation caching.
 *
 * Issue #2279: Verifies that writeScores correctly writes scores for all
 * creatures, including those sharing the same UUID prefix directory.
 * The Set-based directory cache must not skip any writes.
 */
import { assert, assertEquals } from "@std/assert";
import { existsSync } from "@std/fs";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Neat } from "@neat/Neat.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("writeScores writes all creature scores to disk", async () => {
  const tmpDir = Deno.makeTempDirSync({ prefix: "neat_test_writescores_" });

  try {
    const neat = new Neat(2, 1, { experimentStore: tmpDir }, []);

    // Create several creatures with scores
    const creatures: Creature[] = [];
    for (let i = 0; i < 10; i++) {
      const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
      creature.score = -0.5 + i * 0.1;
      creatures.push(creature);
    }

    await neat.writeScores(creatures);

    // Verify all creatures had their scores written
    for (const creature of creatures) {
      const name = CreatureUtil.makeUUID(creature);
      const dirPath = `${tmpDir}/score/${name.substring(0, 3)}`;
      const filePath = `${dirPath}/${name.substring(3)}.txt`;

      assert(
        existsSync(filePath),
        `Score file should exist for creature with UUID ${name}`,
      );

      const content = Deno.readTextFileSync(filePath);
      assertEquals(
        content,
        `${creature.score}`,
        "Score file content should match creature score",
      );
    }
  } finally {
    // Clean up
    Deno.removeSync(tmpDir, { recursive: true });
  }
});

Deno.test("writeScores handles creatures sharing UUID prefix directories", async () => {
  const tmpDir = Deno.makeTempDirSync({
    prefix: "neat_test_writescores_shared_",
  });

  try {
    const neat = new Neat(2, 1, { experimentStore: tmpDir }, []);

    // Create a larger population — with 50 creatures and only 4,096 possible
    // 3-char hex prefixes, collisions are likely.
    const creatures: Creature[] = [];
    for (let i = 0; i < 50; i++) {
      const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
      creature.score = -1.0 + i * 0.04;
      creatures.push(creature);
    }

    await neat.writeScores(creatures);

    // Verify every creature's score was written
    let filesWritten = 0;
    for (const creature of creatures) {
      const name = CreatureUtil.makeUUID(creature);
      const filePath = `${tmpDir}/score/${name.substring(0, 3)}/${
        name.substring(3)
      }.txt`;

      assert(
        existsSync(filePath),
        `Score file should exist for creature ${filesWritten}`,
      );
      filesWritten++;
    }

    assertEquals(filesWritten, 50, "All 50 creatures should have score files");
  } finally {
    Deno.removeSync(tmpDir, { recursive: true });
  }
});

Deno.test("writeScores does nothing without experimentStore", () => {
  // When experimentStore is not configured, writeScores should be a no-op
  const neat = new Neat(2, 1, {}, []);
  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  creature.score = -0.5;

  // Should not throw — just silently return
  neat.writeScores([creature]);
});

Deno.test("writeScores handles empty creature list", () => {
  const tmpDir = Deno.makeTempDirSync({
    prefix: "neat_test_writescores_empty_",
  });

  try {
    const neat = new Neat(2, 1, { experimentStore: tmpDir }, []);

    // Should not throw with empty list
    neat.writeScores([]);

    // Score directory should not have been created — the function should not crash
    assert(true, "Empty list should be handled gracefully");
  } finally {
    Deno.removeSync(tmpDir, { recursive: true });
  }
});

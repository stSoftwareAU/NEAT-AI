/**
 * Tests for parallelised writeScores (Issue #2315).
 *
 * Verifies that writeScores works correctly when its I/O is overlapped
 * with concurrent CPU work (simulating the speciation overlap in the
 * evolution loop). Ensures no file corruption or missing writes occur
 * under concurrent execution.
 */
import { assert, assertEquals } from "@std/assert";
import { existsSync } from "@std/fs";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Neat } from "@neat/Neat.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

Deno.test("writeScores produces correct files when overlapped with CPU work", async () => {
  const tmpDir = await Deno.makeTempDir({
    prefix: "neat_test_writescores_parallel_",
  });

  try {
    const neat = new Neat(2, 1, { experimentStore: tmpDir }, []);

    const creatures: Creature[] = [];
    for (let i = 0; i < 50; i++) {
      const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
      creature.score = -1.0 + i * 0.04;
      creatures.push(creature);
    }

    // Start writeScores without awaiting immediately (simulating the
    // overlapped execution pattern from NeatEvolution.ts Issue #2315).
    const writePromise = neat.writeScores(creatures);

    // Perform CPU-bound work concurrently (simulating speciation).
    let cpuWorkResult = 0;
    for (const creature of creatures) {
      // Compute UUIDs as speciation would
      const uuid = CreatureUtil.makeUUID(creature);
      cpuWorkResult += uuid.length;
    }
    assert(cpuWorkResult > 0, "CPU work should have executed");

    // Now await the writes to complete
    await writePromise;

    // Verify every creature's score was written correctly
    const verifyPromises = creatures.map(async (creature) => {
      const name = CreatureUtil.makeUUID(creature);
      const filePath = `${tmpDir}/score/${name.substring(0, 3)}/${
        name.substring(3)
      }.txt`;

      assert(existsSync(filePath), `Score file should exist for creature`);

      const content = await Deno.readTextFile(filePath);
      assertEquals(
        content,
        `${creature.score}`,
        "Score file content should match creature score",
      );
    });
    await Promise.all(verifyPromises);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeScores handles large population without file corruption", async () => {
  const tmpDir = await Deno.makeTempDir({
    prefix: "neat_test_writescores_large_",
  });

  try {
    const neat = new Neat(3, 1, { experimentStore: tmpDir }, []);

    // Create a production-sized population
    const creatures: Creature[] = [];
    for (let i = 0; i < 200; i++) {
      const creature = new Creature(3, 1, { layers: [{ count: 5 }] });
      creature.score = -2.0 + i * 0.02;
      creatures.push(creature);
    }

    await neat.writeScores(creatures);

    // Verify all files written with correct content
    let verified = 0;
    const readPromises = creatures.map(async (creature) => {
      const name = CreatureUtil.makeUUID(creature);
      const filePath = `${tmpDir}/score/${name.substring(0, 3)}/${
        name.substring(3)
      }.txt`;

      assert(existsSync(filePath), `Score file should exist`);

      const content = await Deno.readTextFile(filePath);
      assertEquals(content, `${creature.score}`);
      verified++;
    });
    await Promise.all(readPromises);

    assertEquals(verified, 200, "All 200 score files should be verified");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("overlapped writeScores does not interfere with subsequent writes", async () => {
  const tmpDir = await Deno.makeTempDir({
    prefix: "neat_test_writescores_sequential_",
  });

  try {
    const neat = new Neat(2, 1, { experimentStore: tmpDir }, []);

    const creature = new Creature(2, 1, { layers: [{ count: 3 }] });

    // First generation: write initial score
    creature.score = 10;
    const firstWrite = neat.writeScores([creature]);

    // Simulate CPU work between generations
    let work = 0;
    for (let i = 0; i < 1000; i++) work += i;
    assert(work > 0);

    await firstWrite;

    // Second generation: overwrite with updated score
    creature.score = 99;
    await neat.writeScores([creature]);

    const uuid = CreatureUtil.makeUUID(creature);
    const filePath = `${tmpDir}/score/${uuid.substring(0, 3)}/${
      uuid.substring(3)
    }.txt`;

    const content = await Deno.readTextFile(filePath);
    assertEquals(content, "99", "Latest score should be written");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

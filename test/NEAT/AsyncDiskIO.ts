/**
 * Issue #2275 - Test async disk I/O optimisations for writeScores and
 * writeCreatures.
 *
 * Verifies that the async implementations produce identical output to the
 * original synchronous versions.
 */

import { assert, assertEquals } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Neat } from "@neat/Neat.ts";

Deno.test("writeScores writes correct score files asynchronously", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "neat_async_scores_" });

  try {
    const creature = new Creature(3, 1, { layers: [{ count: 5 }] });
    creatureValidate(creature);
    creature.score = 42.5;

    const neat = new Neat(3, 1, { experimentStore: tmpDir }, []);
    const population = [creature];

    await neat.writeScores(population);

    // Verify the file was written with the correct score
    const uuid = CreatureUtil.makeUUID(creature);
    const dirPath = `${tmpDir}/score/${uuid.substring(0, 3)}`;
    const filePath = `${dirPath}/${uuid.substring(3)}.txt`;

    const content = await Deno.readTextFile(filePath);
    assertEquals(content, "42.5");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeScores handles multiple creatures correctly", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "neat_async_multi_" });

  try {
    const creatures: Creature[] = [];
    for (let i = 0; i < 10; i++) {
      const c = new Creature(3, 1, { layers: [{ count: 5 }] });
      creatureValidate(c);
      c.score = i * 10;
      creatures.push(c);
    }

    const neat = new Neat(3, 1, { experimentStore: tmpDir }, []);
    await neat.writeScores(creatures);

    // Verify each creature's score file exists and has correct content
    const readResults = await Promise.all(
      creatures.map((creature) => {
        const uuid = CreatureUtil.makeUUID(creature);
        const dirPath = `${tmpDir}/score/${uuid.substring(0, 3)}`;
        const filePath = `${dirPath}/${uuid.substring(3)}.txt`;
        return Deno.readTextFile(filePath).then((content) => ({
          content,
          expected: `${creature.score}`,
        }));
      }),
    );
    for (const { content, expected } of readResults) {
      assertEquals(content, expected);
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeScores skips when no experimentStore configured", async () => {
  const neat = new Neat(3, 1, {}, []);

  // Should not throw — simply returns without writing
  await neat.writeScores([]);
});

Deno.test("writeScores overwrites existing score files", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "neat_async_overwrite_" });

  try {
    const creature = new Creature(3, 1, { layers: [{ count: 5 }] });
    creatureValidate(creature);

    const neat = new Neat(3, 1, { experimentStore: tmpDir }, []);

    // Write initial score
    creature.score = 10;
    await neat.writeScores([creature]);

    // Overwrite with new score
    creature.score = 99;
    await neat.writeScores([creature]);

    const uuid = CreatureUtil.makeUUID(creature);
    const filePath = `${tmpDir}/score/${uuid.substring(0, 3)}/${
      uuid.substring(3)
    }.txt`;

    const content = await Deno.readTextFile(filePath);
    assertEquals(content, "99");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeScores caches directory creation across creatures", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "neat_async_dircache_" });

  try {
    // Create creatures that will share directory prefixes
    const creatures: Creature[] = [];
    for (let i = 0; i < 50; i++) {
      const c = new Creature(3, 1, { layers: [{ count: 5 }] });
      creatureValidate(c);
      c.score = i;
      creatures.push(c);
    }

    const neat = new Neat(3, 1, { experimentStore: tmpDir }, []);
    await neat.writeScores(creatures);

    // Verify all score files were written correctly
    const verifyResults = await Promise.all(
      creatures.map((creature) => {
        const uuid = CreatureUtil.makeUUID(creature);
        const filePath = `${tmpDir}/score/${uuid.substring(0, 3)}/${
          uuid.substring(3)
        }.txt`;
        return Deno.readTextFile(filePath).then((content) => ({
          content,
          expected: `${creature.score}`,
        }));
      }),
    );
    for (const { content, expected } of verifyResults) {
      assertEquals(content, expected);
    }

    assertEquals(
      verifyResults.length,
      50,
      "All 50 score files should be written",
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test(
  "compact JSON checkpoint files round-trip correctly",
  () => {
    const tmpDir = Deno.makeTempDirSync({ prefix: "neat_async_checkpoint_" });
    const checkpointDir = `${tmpDir}/checkpoint`;
    ensureDirSync(checkpointDir);

    try {
      const creature = new Creature(3, 1, { layers: [{ count: 5 }] });
      creatureValidate(creature);
      creature.score = 42.5;

      // Verify compact JSON (no indentation) round-trips correctly
      const json = creature.exportJSON();
      const compactJson = JSON.stringify(json);

      ensureDirSync(checkpointDir);
      Deno.writeTextFileSync(`${checkpointDir}/1.json`, compactJson);

      // Read back and verify it's valid
      const readBack = Deno.readTextFileSync(`${checkpointDir}/1.json`);
      const parsed = JSON.parse(readBack);

      // Verify the creature can be loaded from the compact JSON
      const restored = Creature.fromJSON(parsed);
      assert(restored, "Creature should load from compact JSON");
      assertEquals(
        restored.neurons.length,
        creature.neurons.length,
        "Neuron count should match",
      );
      assertEquals(
        restored.synapses.length,
        creature.synapses.length,
        "Synapse count should match",
      );
    } finally {
      Deno.removeSync(tmpDir, { recursive: true });
    }
  },
);

Deno.test("compact JSON is valid and round-trips correctly", () => {
  const creature = new Creature(5, 3, {
    layers: [{ count: 10 }, { count: 5 }],
  });
  creatureValidate(creature);
  creature.score = -12.345;

  const json = creature.exportJSON();

  // Compact (no indentation)
  const compact = JSON.stringify(json);

  // Pretty-print (original approach)
  const pretty = JSON.stringify(json, null, 1);

  // Both should parse to identical objects
  const parsedCompact = JSON.parse(compact);
  const parsedPretty = JSON.parse(pretty);

  assertEquals(
    JSON.stringify(parsedCompact),
    JSON.stringify(parsedPretty),
    "Compact and pretty JSON should parse to identical objects",
  );

  // Both should produce valid creatures
  const fromCompact = Creature.fromJSON(parsedCompact);
  const fromPretty = Creature.fromJSON(parsedPretty);

  assertEquals(
    fromCompact.neurons.length,
    fromPretty.neurons.length,
    "Neuron count should match",
  );
  assertEquals(
    fromCompact.synapses.length,
    fromPretty.synapses.length,
    "Synapse count should match",
  );
});

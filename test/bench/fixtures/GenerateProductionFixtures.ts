/**
 * Tests for the production-scale profiling fixture generator (issue #2306).
 *
 * Validates that:
 * - The creature fixture matches GRQ-cluster dimensions (~1,500 neurons, ~20,000 synapses).
 * - The training data generator produces the correct number of binary files
 *   with correct record sizes.
 * - Generation is deterministic (seeded PRNG produces identical output).
 * - Fixtures integrate with the binary format expected by `profileEvolveDir.ts`.
 */

import { assert, assertEquals, assertGreater } from "@std/assert";
import { existsSync } from "@std/fs/exists";
import {
  createSeededRng,
  generateProductionCreature,
} from "../../propagate/large/ProductionScaleCreature.ts";
import {
  generateAllFixtures,
  generateCreatureFixture,
  generateTrainingDataFixtures,
  PRODUCTION_DEFAULTS,
} from "../../../bench/fixtures/generateProductionFixtures.ts";
import type { ProductionFixtureConfig } from "../../../bench/fixtures/generateProductionFixtures.ts";

/** Small-scale config for fast test execution. */
function testConfig(suffix: string): ProductionFixtureConfig {
  return {
    seed: PRODUCTION_DEFAULTS.seed,
    inputCount: PRODUCTION_DEFAULTS.inputCount,
    outputCount: PRODUCTION_DEFAULTS.outputCount,
    fileCount: 3,
    recordsPerFile: 10,
    outputDir: Deno.makeTempDirSync({ prefix: `fixture-test-${suffix}-` }),
  };
}

Deno.test("GRQ-cluster creature has ~1,500 neurons", () => {
  const rng = createSeededRng(2306);
  const creature = generateProductionCreature(648, 2, rng, {
    scale: "grq-cluster",
  });

  const hiddenNeurons = creature.neurons.filter((n) => n.type === "hidden");
  const outputNeurons = creature.neurons.filter((n) => n.type === "output");
  const totalNeurons = hiddenNeurons.length + outputNeurons.length;

  // Production target: ~1,500 neurons (accept 1,400–1,600 range)
  assertGreater(totalNeurons, 1_400, "too few neurons for GRQ-cluster scale");
  assert(totalNeurons < 1_700, `too many neurons: ${totalNeurons}`);
  assertEquals(outputNeurons.length, 2, "output neuron count mismatch");
});

Deno.test("GRQ-cluster creature has ~20,000 synapses", () => {
  const rng = createSeededRng(2306);
  const creature = generateProductionCreature(648, 2, rng, {
    scale: "grq-cluster",
  });

  // Production target: ~19,850 synapses (accept 18,000–22,000 range)
  assertGreater(
    creature.synapses.length,
    18_000,
    "too few synapses for GRQ-cluster scale",
  );
  assert(
    creature.synapses.length < 22_000,
    `too many synapses: ${creature.synapses.length}`,
  );
});

Deno.test("GRQ-cluster creature generation is deterministic", () => {
  const rng1 = createSeededRng(2306);
  const creature1 = generateProductionCreature(648, 2, rng1, {
    scale: "grq-cluster",
  });

  const rng2 = createSeededRng(2306);
  const creature2 = generateProductionCreature(648, 2, rng2, {
    scale: "grq-cluster",
  });

  assertEquals(
    creature1.neurons.length,
    creature2.neurons.length,
    "neuron count should be identical across runs",
  );
  assertEquals(
    creature1.synapses.length,
    creature2.synapses.length,
    "synapse count should be identical across runs",
  );

  // Verify first few neurons are exactly the same
  for (let i = 0; i < Math.min(10, creature1.neurons.length); i++) {
    assertEquals(
      creature1.neurons[i].uuid,
      creature2.neurons[i].uuid,
      `neuron ${i} UUID should match`,
    );
    assertEquals(
      creature1.neurons[i].squash,
      creature2.neurons[i].squash,
      `neuron ${i} squash should match`,
    );
  }
});

Deno.test("default scale unchanged (~1,060 neurons)", () => {
  const rng = createSeededRng(42);
  const creature = generateProductionCreature(648, 2, rng);

  const totalNeurons = creature.neurons.length;
  // Original default: ~1,062 neurons (7 layers summing to 1,060 + 2 output)
  assertGreater(
    totalNeurons,
    1_000,
    "default scale should produce ~1,060 neurons",
  );
  assert(
    totalNeurons < 1_200,
    `default scale has too many neurons: ${totalNeurons}`,
  );
});

Deno.test("creature fixture writes valid JSON file", () => {
  const config = testConfig("creature");
  try {
    const result = generateCreatureFixture(config);

    assert(existsSync(result.path), "creature JSON file should exist");
    const raw = Deno.readTextFileSync(result.path);
    const parsed = JSON.parse(raw);

    assertEquals(parsed.input, config.inputCount);
    assertEquals(parsed.output, config.outputCount);
    assertGreater(parsed.neurons.length, 1_400);
    assertGreater(parsed.synapses.length, 18_000);
  } finally {
    Deno.removeSync(config.outputDir, { recursive: true });
  }
});

Deno.test("training data generator produces correct file count", () => {
  const config = testConfig("filecount");
  try {
    const result = generateTrainingDataFixtures(config);

    assertEquals(result.fileCount, config.fileCount);
    assertEquals(result.totalRecords, config.fileCount * config.recordsPerFile);

    // Verify files exist on disk
    for (let i = 0; i < config.fileCount; i++) {
      const filePath = `${result.dataDir}/${i}.bin`;
      assert(existsSync(filePath), `binary file ${i}.bin should exist`);
    }
  } finally {
    Deno.removeSync(config.outputDir, { recursive: true });
  }
});

Deno.test("training data binary files have correct byte sizes", () => {
  const config = testConfig("bytesize");
  try {
    const result = generateTrainingDataFixtures(config);
    const expectedRecordBytes = (config.inputCount + config.outputCount) * 4;
    const expectedFileBytes = expectedRecordBytes * config.recordsPerFile;

    for (let i = 0; i < config.fileCount; i++) {
      const filePath = `${result.dataDir}/${i}.bin`;
      const stat = Deno.statSync(filePath);
      assertEquals(
        stat.size,
        expectedFileBytes,
        `file ${i}.bin should be ${expectedFileBytes} bytes`,
      );
    }

    assertEquals(result.totalBytes, expectedFileBytes * config.fileCount);
  } finally {
    Deno.removeSync(config.outputDir, { recursive: true });
  }
});

Deno.test("training data generation is deterministic", () => {
  const config1 = testConfig("det1");
  const config2 = testConfig("det2");
  try {
    generateTrainingDataFixtures(config1);
    generateTrainingDataFixtures(config2);

    // Compare first file byte-for-byte
    const file1 = Deno.readFileSync(`${config1.outputDir}/data/0.bin`);
    const file2 = Deno.readFileSync(`${config2.outputDir}/data/0.bin`);
    assertEquals(file1.length, file2.length, "file sizes should match");

    // Check first 1000 bytes for identity
    for (let i = 0; i < Math.min(1000, file1.length); i++) {
      assertEquals(
        file1[i],
        file2[i],
        `byte ${i} should be identical across deterministic runs`,
      );
    }
  } finally {
    Deno.removeSync(config1.outputDir, { recursive: true });
    Deno.removeSync(config2.outputDir, { recursive: true });
  }
});

Deno.test("generateAllFixtures produces complete result", () => {
  const config = testConfig("all");
  try {
    const result = generateAllFixtures({
      ...config,
    });

    assert(existsSync(result.creaturePath), "creature file should exist");
    assert(existsSync(result.dataDir), "data directory should exist");
    assertGreater(result.neuronCount, 1_400);
    assertGreater(result.synapseCount, 18_000);
    assertEquals(result.fileCount, config.fileCount);
    assertEquals(result.totalRecords, config.fileCount * config.recordsPerFile);
    assertGreater(result.totalBytes, 0);
  } finally {
    Deno.removeSync(config.outputDir, { recursive: true });
  }
});

Deno.test("GRQ-cluster creature has diverse squash functions", () => {
  const rng = createSeededRng(2306);
  const creature = generateProductionCreature(648, 2, rng, {
    scale: "grq-cluster",
  });

  const squashSet = new Set(creature.neurons.map((n) => n.squash));
  // Should use at least 15 different squash functions for diversity
  assertGreater(
    squashSet.size,
    15,
    `expected diverse squash functions, got only ${squashSet.size}: ${
      [...squashSet].join(", ")
    }`,
  );
});

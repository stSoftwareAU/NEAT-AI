/**
 * generateProductionFixtures.ts — Deterministically generate production-scale
 * creature and binary training data fixtures matching GRQ-cluster dimensions.
 *
 * Issue #2306 — Creates benchmark fixtures for realistic profiling so that
 * bottleneck analysis reflects production workloads rather than small-data
 * artefacts.
 *
 * **Production dimensions (from performance.csv):**
 * - Neurons: ~1,500
 * - Synapses: ~19,850
 * - Training data files: 520
 * - Training data size: ~20 GB (binary format)
 *
 * **Usage:**
 * ```bash
 * deno run --no-prompt --allow-read --allow-write --allow-env \
 *   bench/fixtures/generateProductionFixtures.ts \
 *   [--output-dir=.hidden/production-fixtures] \
 *   [--file-count=520] \
 *   [--records-per-file=5000]
 * ```
 *
 * **Then profile with:**
 * ```bash
 * deno run --no-prompt --unstable-worker-options \
 *   --allow-read --allow-write --allow-env --allow-net --allow-import --allow-ffi \
 *   scripts/profileEvolveDir.ts \
 *   --creature=.hidden/production-fixtures/creature.json \
 *   --data=.hidden/production-fixtures/data
 * ```
 *
 * All output goes to `.hidden/` (gitignored via `.*` in `.gitignore`).
 * Generation is deterministic (seeded PRNG) for reproducible profiling.
 */

import { ensureDirSync } from "@std/fs/ensure-dir";
import {
  createSeededRng,
  generateProductionCreature,
} from "../../test/propagate/large/ProductionScaleCreature.ts";

/** Default configuration matching GRQ-cluster production dimensions. */
export const PRODUCTION_DEFAULTS = {
  /** Seed for deterministic generation. */
  seed: 2306,
  /** Number of creature input neurons. */
  inputCount: 648,
  /** Number of creature output neurons. */
  outputCount: 2,
  /** Number of binary training data files to generate. */
  fileCount: 520,
  /** Number of records per binary file. */
  recordsPerFile: 5_000,
  /** Output directory for all generated fixtures. */
  outputDir: ".hidden/production-fixtures",
} as const;

/**
 * Configuration for production fixture generation.
 */
export interface ProductionFixtureConfig {
  seed: number;
  inputCount: number;
  outputCount: number;
  fileCount: number;
  recordsPerFile: number;
  outputDir: string;
}

/**
 * Result summary from fixture generation.
 */
export interface FixtureGenerationResult {
  creaturePath: string;
  dataDir: string;
  neuronCount: number;
  synapseCount: number;
  fileCount: number;
  totalRecords: number;
  totalBytes: number;
}

/**
 * Generate a production-scale creature JSON file.
 *
 * Uses the enhanced `generateProductionCreature` with layer widths tuned
 * to produce ~1,500 neurons and ~19,850 synapses.
 */
export function generateCreatureFixture(
  config: ProductionFixtureConfig,
): { path: string; neuronCount: number; synapseCount: number } {
  const rng = createSeededRng(config.seed);
  const creature = generateProductionCreature(
    config.inputCount,
    config.outputCount,
    rng,
    { scale: "grq-cluster" },
  );

  const creaturePath = `${config.outputDir}/creature.json`;
  Deno.writeTextFileSync(creaturePath, JSON.stringify(creature, null, 1));

  return {
    path: creaturePath,
    neuronCount: creature.neurons.length,
    synapseCount: creature.synapses.length,
  };
}

/**
 * Generate binary training data files matching production dimensions.
 *
 * Each file contains `recordsPerFile` records in binary format:
 * [Float32 × inputCount] + [Float32 × outputCount] per record.
 *
 * Data is deterministic — the same seed always produces identical files.
 */
export function generateTrainingDataFixtures(
  config: ProductionFixtureConfig,
): {
  dataDir: string;
  fileCount: number;
  totalRecords: number;
  totalBytes: number;
} {
  const dataDir = `${config.outputDir}/data`;
  ensureDirSync(dataDir);

  const rng = createSeededRng(config.seed + 1_000_000);
  const recordSize = (config.inputCount + config.outputCount) * 4; // bytes per record
  let totalBytes = 0;

  const inputBuffer = new Float32Array(config.inputCount);
  const outputBuffer = new Float32Array(config.outputCount);

  for (let fileIdx = 0; fileIdx < config.fileCount; fileIdx++) {
    const filePath = `${dataDir}/${fileIdx}.bin`;
    const file = Deno.openSync(filePath, {
      write: true,
      create: true,
      truncate: true,
    });

    for (let rec = 0; rec < config.recordsPerFile; rec++) {
      // Generate deterministic input values
      for (let j = 0; j < config.inputCount; j++) {
        inputBuffer[j] = (rng() - 0.5) * 2;
      }

      // Generate deterministic output values (weighted combination of inputs)
      for (let j = 0; j < config.outputCount; j++) {
        let sum = 0;
        const stride = j * 7 + 3;
        for (let k = 0; k < Math.min(10, config.inputCount); k++) {
          sum += inputBuffer[k * stride % config.inputCount] *
            (rng() - 0.5);
        }
        outputBuffer[j] = Math.tanh(sum);
      }

      file.writeSync(new Uint8Array(inputBuffer.buffer));
      file.writeSync(new Uint8Array(outputBuffer.buffer));
    }

    file.close();
    totalBytes += config.recordsPerFile * recordSize;

    // Progress feedback every 50 files
    if ((fileIdx + 1) % 50 === 0 || fileIdx === config.fileCount - 1) {
      console.error(
        `  Generated ${fileIdx + 1}/${config.fileCount} training files ` +
          `(${(totalBytes / (1024 * 1024)).toFixed(0)} MB)`,
      );
    }
  }

  return {
    dataDir,
    fileCount: config.fileCount,
    totalRecords: config.fileCount * config.recordsPerFile,
    totalBytes,
  };
}

/**
 * Generate all production-scale fixtures (creature + training data).
 */
export function generateAllFixtures(
  config: Partial<ProductionFixtureConfig> = {},
): FixtureGenerationResult {
  const fullConfig: ProductionFixtureConfig = {
    ...PRODUCTION_DEFAULTS,
    ...config,
  };

  ensureDirSync(fullConfig.outputDir);

  console.error("Generating production-scale creature fixture...");
  const creature = generateCreatureFixture(fullConfig);
  console.error(
    `  Creature: ${creature.neuronCount} neurons, ${creature.synapseCount} synapses`,
  );

  console.error("Generating production-scale training data...");
  const training = generateTrainingDataFixtures(fullConfig);
  console.error(
    `  Training: ${training.fileCount} files, ` +
      `${training.totalRecords.toLocaleString()} records, ` +
      `${(training.totalBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`,
  );

  return {
    creaturePath: creature.path,
    dataDir: training.dataDir,
    neuronCount: creature.neuronCount,
    synapseCount: creature.synapseCount,
    fileCount: training.fileCount,
    totalRecords: training.totalRecords,
    totalBytes: training.totalBytes,
  };
}

/** Parse CLI arguments. */
function parseArgs(): Partial<ProductionFixtureConfig> {
  const config: Partial<ProductionFixtureConfig> = {};
  for (const arg of Deno.args) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq < 0) continue;
    const key = arg.slice(2, eq);
    const val = arg.slice(eq + 1);
    switch (key) {
      case "output-dir":
        config.outputDir = val;
        break;
      case "file-count":
        config.fileCount = parseInt(val, 10);
        break;
      case "records-per-file":
        config.recordsPerFile = parseInt(val, 10);
        break;
      case "seed":
        config.seed = parseInt(val, 10);
        break;
      case "input-count":
        config.inputCount = parseInt(val, 10);
        break;
      case "output-count":
        config.outputCount = parseInt(val, 10);
        break;
    }
  }
  return config;
}

if (import.meta.main) {
  const config = parseArgs();
  const result = generateAllFixtures(config);

  console.error("\n=== Production Fixture Generation Complete ===");
  console.error(`  Creature: ${result.creaturePath}`);
  console.error(`  Data:     ${result.dataDir}`);
  console.error(
    `  Scale:    ${result.neuronCount} neurons, ${result.synapseCount} synapses`,
  );
  console.error(
    `  Data:     ${result.fileCount} files, ${result.totalRecords.toLocaleString()} records`,
  );
  console.error(
    `\nTo profile:\n  deno run --no-prompt --unstable-worker-options \\`,
  );
  console.error(
    `    --allow-read --allow-write --allow-env --allow-net --allow-import --allow-ffi \\`,
  );
  console.error(`    scripts/profileEvolveDir.ts \\`);
  console.error(
    `    --creature=${result.creaturePath} --data=${result.dataDir}`,
  );
}

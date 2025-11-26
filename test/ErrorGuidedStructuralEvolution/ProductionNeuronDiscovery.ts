/**
 * Diagnostic tests for neuron discovery with REAL production creatures.
 *
 * This test loads an actual production creature (GRQ-18-1.json) to diagnose
 * why neuron discovery might not be finding candidates in production.
 *
 * Created: 26-Nov-2025
 */
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import {
  DEFAULT_RUST_FLUSH_RECORDS,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  isRustDiscoveryEnabled,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

const PRODUCTION_CREATURE_PATH =
  "/Users/nigelleck/src/GRQ-sampler/samples/GRQ-18-1.json";

/**
 * Check if the production creature file exists.
 */
async function productionCreatureExists(): Promise<boolean> {
  try {
    await Deno.stat(PRODUCTION_CREATURE_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate synthetic training data for a creature.
 */
function generateTrainingData(
  creature: Creature,
  sampleCount: number,
): DataRecordInterface[] {
  const data: DataRecordInterface[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const input = new Float32Array(creature.input);
    for (let j = 0; j < creature.input; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    // Use creature's own output as target (tests ability to find structural improvements)
    const output = creature.activate(input);
    // Add some noise to create error for discovery to find
    const noisyOutput = new Float32Array(output.length);
    for (let k = 0; k < output.length; k++) {
      noisyOutput[k] = output[k] + (Math.random() - 0.5) * 0.1;
    }
    data.push({ input, output: noisyOutput });
  }
  return data;
}

Deno.test({
  name: "Production creature: diagnostic analysis",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    if (!(await productionCreatureExists())) {
      console.log(
        `⚠ Production creature not found at ${PRODUCTION_CREATURE_PATH}`,
      );
      console.log(
        "  Skipping test - copy a production creature to run this diagnostic",
      );
      return;
    }

    console.log("\n========================================");
    console.log("PRODUCTION CREATURE DIAGNOSTIC");
    console.log("========================================\n");

    // Load the creature
    const creatureJson = JSON.parse(
      await Deno.readTextFile(PRODUCTION_CREATURE_PATH),
    );
    const creature = Creature.fromJSON(creatureJson);
    creature.validate();
    CreatureUtil.makeUUID(creature);

    console.log("Creature stats:");
    console.log(`  Input: ${creature.input}`);
    console.log(`  Output: ${creature.output}`);
    console.log(`  Neurons: ${creature.neurons.length}`);

    // Count neurons by type
    const hiddenNeurons = creature.neurons.filter((n) => n.type === "hidden");
    console.log(`  Hidden neurons: ${hiddenNeurons.length}`);

    // Count squash functions
    const squashCounts = new Map<string, number>();
    hiddenNeurons.forEach((n) => {
      const squash = n.squash || "IDENTITY";
      squashCounts.set(squash, (squashCounts.get(squash) || 0) + 1);
    });

    console.log("\n  Squash functions:");
    const sortedSquashes = [...squashCounts.entries()].sort((a, b) =>
      b[1] - a[1]
    );
    sortedSquashes.slice(0, 10).forEach(([squash, count]) => {
      console.log(`    ${squash}: ${count}`);
    });

    // Check which are supported by Rust
    const supportedSquashes = new Set([
      "ReLU",
      "GELU",
      "ELU",
      "SELU",
      "Softplus",
      "LOGISTIC",
      "TANH",
      "LeakyReLU",
      "IDENTITY",
      "INVERSE",
    ]);
    let supportedCount = 0;
    squashCounts.forEach((count, squash) => {
      if (supportedSquashes.has(squash)) {
        supportedCount += count;
      }
    });
    console.log(
      `\n  Neurons with Rust-supported squashes: ${supportedCount}/${hiddenNeurons.length}`,
    );

    // Generate training data
    console.log("\nGenerating training data...");
    const trainingData = generateTrainingData(creature, 256);
    console.log(`  Generated ${trainingData.length} samples`);

    // Run discovery
    console.log("\nRunning discovery...");
    console.log(`  Rust discovery enabled: ${isRustDiscoveryEnabled()}`);

    const discoverStructure = new DiscoverStructure(
      creature,
      300, // 5 minutes timeout
      DEFAULT_RUST_FLUSH_RECORDS,
    );

    const neuronPromises = new Map<string, Promise<void>>();

    try {
      discoverStructure.initialize(neuronPromises);

      console.log("\n--- Recording phase ---");
      const recordStart = Date.now();
      const recorded = discoverStructure.record(trainingData, neuronPromises);
      console.log(`  Record returned: ${recorded}`);
      await Promise.all([...neuronPromises.values()]);
      console.log(`  Recording time: ${Date.now() - recordStart}ms`);

      console.log("\n--- Flush phase ---");
      const flushStart = Date.now();
      const flushSuccess = discoverStructure.flushRustRecording();
      console.log(`  Flush returned: ${flushSuccess}`);
      console.log(`  Flush time: ${Date.now() - flushStart}ms`);

      // Get focus neurons (high error)
      console.log("\n--- Focus selection ---");
      const focusStart = Date.now();
      const focusList = await discoverStructure.selectNeuronsWeightedByError(
        6,
        undefined,
        0,
      );
      console.log(`  Focus neurons: ${focusList.length}`);
      console.log(`  Selection time: ${Date.now() - focusStart}ms`);
      focusList.forEach((uuid) => {
        console.log(`    - ${uuid}`);
      });

      // Analyse for missing neurons
      console.log("\n--- Neuron analysis ---");
      const analyseStart = Date.now();
      const candidates = await discoverStructure.analyzeMissingNeurons(
        focusList,
      );
      console.log(`  Analysis time: ${Date.now() - analyseStart}ms`);
      console.log(`  Candidates found: ${candidates?.length ?? 0}`);

      if (candidates && candidates.length > 0) {
        console.log("\n  Top candidates:");
        candidates.slice(0, 5).forEach((c, i) => {
          console.log(`  ${i + 1}. ${c.squash}`);
          console.log(`     from: ${c.fromNeuronUUID}`);
          console.log(`     to: ${c.toNeuronUUID}`);
          console.log(
            `     improvement: ${
              (c.expectedImprovementPercentage * 100).toFixed(2)
            }%`,
          );
          console.log(`     samples: ${c.improvedCount}/${c.totalCount}`);
        });

        // Try adding a neuron
        const improved = DiscoverStructure.addHelpfulNeurons(
          "diagnostic",
          creature,
          candidates.slice(0, 1),
        );
        if (improved) {
          improved.validate();
          console.log("\n✓ Successfully added discovery neuron");
        }
      } else {
        console.log("\n⚠ NO NEURON CANDIDATES FOUND");
        console.log("  Possible reasons:");
        console.log(
          "  1. Most neurons use unsupported squash functions (only ~19% supported)",
        );
        console.log("  2. Creature is already well-optimised");
        console.log("  3. Training data doesn't reveal structural gaps");
        console.log("  4. Focus neurons don't have improvable upstream paths");
      }

      // Also test synapse discovery for comparison
      console.log("\n--- Synapse analysis (for comparison) ---");
      const synapseStart = Date.now();
      const synapseCandidates = await discoverStructure.analyzeSelectedNeurons(
        focusList,
      );
      console.log(`  Analysis time: ${Date.now() - synapseStart}ms`);
      console.log(`  Synapse candidates: ${synapseCandidates?.length ?? 0}`);

      // Test collectRustAnalysisCandidates (production method)
      console.log(
        "\n--- Production method (collectRustAnalysisCandidates) ---",
      );
      const bundleStart = Date.now();
      const bundle = discoverStructure.collectRustAnalysisCandidates(
        focusList,
      );
      console.log(`  Collection time: ${Date.now() - bundleStart}ms`);

      if (bundle) {
        console.log(
          `  helpfulSynapses: ${bundle.helpfulSynapses?.length ?? 0}`,
        );
        console.log(
          `  harmfulSynapse: ${bundle.harmfulSynapse ? "yes" : "no"}`,
        );
        console.log(`  helpfulNeurons: ${bundle.helpfulNeurons?.length ?? 0}`);
      } else {
        console.log("  Bundle is undefined - Rust analysis failed");
      }

      console.log("\n========================================\n");
    } finally {
      await discoverStructure.cleanUp();
    }
  },
});

Deno.test({
  name: "Production creature: test with actual training data directory",
  ignore: shouldSkipRustDiscoveryTests(),
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    if (!(await productionCreatureExists())) {
      console.log("⚠ Production creature not found, skipping");
      return;
    }

    // Check for actual training data
    const trainingDataDir = "/Users/nigelleck/src/GRQ-sampler/data";
    try {
      await Deno.stat(trainingDataDir);
    } catch {
      console.log(`⚠ Training data directory not found at ${trainingDataDir}`);
      console.log("  This test requires actual production training data");
      return;
    }

    console.log("\n=== PRODUCTION CREATURE WITH REAL DATA ===\n");

    // Load creature
    const creatureJson = JSON.parse(
      await Deno.readTextFile(PRODUCTION_CREATURE_PATH),
    );
    const creature = Creature.fromJSON(creatureJson);
    creature.validate();
    CreatureUtil.makeUUID(creature);

    console.log(`Creature: ${creature.neurons.length} neurons`);
    console.log(`Training data dir: ${trainingDataDir}`);

    // Use discoveryDir which is the production method
    const result = await creature.discoveryDir(trainingDataDir, {
      discoveryTimeOutMinutes: 2,
      discoveryAnalysisTimeoutMinutes: 5,
      verbose: true,
    });

    const discovery = result.discovery;
    console.log("\nDiscovery result:");
    console.log(`  ID: ${discovery.ID}`);
    console.log(
      `  helpfulSynapses: ${discovery.addHelpfulSynapses?.length ?? 0}`,
    );
    console.log(
      `  helpfulNeurons: ${discovery.addHelpfulNeurons?.length ?? 0}`,
    );
    console.log(
      `  harmfulSynapse: ${discovery.removeHarmfulSynapse ? "yes" : "no"}`,
    );
    console.log(
      `  candidateSquashes: ${discovery.candidateSquashes?.length ?? 0}`,
    );

    console.log("\nEvaluation result:");
    console.log(`  Original error: ${result.original.error.toFixed(6)}`);
    console.log(`  Original score: ${result.original.score.toFixed(6)}`);
    if (result.improvement) {
      console.log(`  ✓ Improvement found: ${result.improvement.changeType}`);
      console.log(`    New error: ${result.improvement.error.toFixed(6)}`);
      console.log(
        `    Score delta: ${result.improvement.scoreDelta.toFixed(6)}`,
      );
    } else {
      console.log("  ⚠ No improvement found after re-scoring");
    }

    if (
      discovery.addHelpfulNeurons && discovery.addHelpfulNeurons.length > 0
    ) {
      console.log("\n✓ Neuron discovery found candidates!");
      discovery.addHelpfulNeurons.forEach((n) => {
        console.log(`  ${n.squash}: ${n.fromNeuronUUID} -> ${n.toNeuronUUID}`);
      });
    } else {
      console.log("\n⚠ No neuron candidates found in production run");
    }
  },
});

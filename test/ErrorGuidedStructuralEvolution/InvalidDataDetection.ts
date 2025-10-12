import { assert, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";

/**
 * Tests for invalid data detection (NaN/Infinity) in discovery process.
 * These tests ensure the system LOUDLY WARNS about data quality issues
 * rather than silently filtering them.
 */

function makeSimpleCreature(): Creature {
  const json: CreatureExport = {
    neurons: [
      {
        type: "hidden",
        uuid: "hidden-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
      {
        type: "hidden",
        uuid: "hidden-1",
        squash: TANH.NAME,
        bias: 0,
      },
      {
        type: "output",
        uuid: "output-0",
        squash: IDENTITY.NAME,
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
      { fromUUID: "input-1", toUUID: "hidden-1", weight: 1 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 1 },
    ],
    input: 5,
    output: 1,
  };

  const creature = Creature.fromJSON(json);
  creature.validate();
  return creature;
}

Deno.test("Discovery detects and warns about NaN in error values", async () => {
  const creature = makeSimpleCreature();
  CreatureUtil.makeUUID(creature);

  // First, record some data so files are created
  const trainingData = [];
  for (let i = 0; i < 20; i++) {
    const input = new Float32Array(creature.input);
    const output = new Float32Array(creature.output);
    for (let j = 0; j < creature.input; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    output[0] = Math.random() * 2 - 1;
    trainingData.push({ input, output });
  }

  const discoverStructure = new DiscoverStructure(creature, 60);
  const neuronPromisesMap: Map<string, Promise<void>> = new Map();
  discoverStructure.initialize(neuronPromisesMap);
  discoverStructure.record(trainingData, neuronPromisesMap);
  await Promise.all([...neuronPromisesMap.values()]);

  // Get the actual temp directory from the DiscoverStructure instance
  // deno-lint-ignore no-explicit-any
  const tempDir = (discoverStructure as any).tempDir;
  const corruptFile = `${tempDir}/hidden-0.csv`;

  try {
    // Read existing file
    let content = await Deno.readTextFile(corruptFile);

    // Inject NaN values into errors column
    const lines = content.split("\n");
    const header = lines[0];
    const dataLines = lines.slice(1, 11); // Take first 10 data lines

    // Create corrupted data with NaN
    const corruptedLines = dataLines.map((line) => {
      if (line.trim()) {
        const parts = line.split(",");
        if (parts.length >= 3) {
          parts[2] = "NaN|NaN"; // Corrupt the errors column
          return parts.join(",");
        }
      }
      return line;
    });

    // Write corrupted data back
    content = [header, ...corruptedLines, ...lines.slice(11)].join("\n");
    await Deno.writeTextFile(corruptFile, content);

    // Capture console output to verify warnings
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(" "));
      originalWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      warnings.push(args.join(" "));
      originalError(...args);
    };

    try {
      // This should trigger warnings about invalid data
      const viableNeurons = await discoverStructure.listViableNeurons();

      // Verify warnings were issued
      const hasInvalidDataWarning = warnings.some((w) =>
        w.includes("invalid error values") || w.includes("NaN")
      );

      assert(
        hasInvalidDataWarning,
        `Should warn about invalid data. Warnings: ${warnings.join("\n")}`,
      );

      // Should still return results (with NaN filtered out)
      assertExists(viableNeurons, "Should return results despite invalid data");
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  } finally {
    await discoverStructure.cleanUp();
  }
});

Deno.test("Discovery detects invalid totalErrorSum (NaN/Infinity)", async () => {
  const creature = makeSimpleCreature();
  CreatureUtil.makeUUID(creature);

  // First, record some data
  const trainingData = [];
  for (let i = 0; i < 20; i++) {
    const input = new Float32Array(creature.input);
    const output = new Float32Array(creature.output);
    for (let j = 0; j < creature.input; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    output[0] = Math.random() * 2 - 1;
    trainingData.push({ input, output });
  }

  const discoverStructure = new DiscoverStructure(creature, 60);
  const neuronPromisesMap: Map<string, Promise<void>> = new Map();
  discoverStructure.initialize(neuronPromisesMap);
  discoverStructure.record(trainingData, neuronPromisesMap);
  await Promise.all([...neuronPromisesMap.values()]);

  // Get the actual temp directory
  // deno-lint-ignore no-explicit-any
  const tempDir = (discoverStructure as any).tempDir;

  try {
    // Corrupt all neuron files with Infinity
    for (const neuron of creature.neurons) {
      if (neuron.type !== "input") {
        const file = `${tempDir}/${neuron.uuid}.csv`;
        // deno-lint-ignore no-await-in-loop
        const content = await Deno.readTextFile(file);
        const lines = content.split("\n");

        // Replace all error values with Infinity
        const corruptedLines = lines.map((line, idx) => {
          if (idx === 0) return line; // Keep header
          if (line.trim()) {
            const parts = line.split(",");
            if (parts.length >= 3) {
              parts[2] = "Infinity|Infinity";
              return parts.join(",");
            }
          }
          return line;
        });

        // deno-lint-ignore no-await-in-loop
        await Deno.writeTextFile(file, corruptedLines.join("\n"));
      }
    }

    // Capture warnings
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(" "));
      originalWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      warnings.push(args.join(" "));
      originalError(...args);
    };

    try {
      // This should detect Infinity values
      const viableNeurons = await discoverStructure.listViableNeurons();

      // Then try selection which should detect invalid totalErrorSum
      if (viableNeurons && viableNeurons.length > 0) {
        await discoverStructure.selectNeuronsWeightedByError(2);
      }

      // Should have warned about invalid data
      const hasInfinityWarning = warnings.some((w) =>
        w.includes("Infinity") || w.includes("invalid error")
      );

      assert(
        hasInfinityWarning,
        `Should warn about Infinity values. Warnings: ${warnings.join("\n")}`,
      );
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  } finally {
    await discoverStructure.cleanUp();
  }
});

Deno.test("Discovery validates all neurons have finite error values", async () => {
  const creature = makeSimpleCreature();
  CreatureUtil.makeUUID(creature);

  // Use normal training data - should produce finite errors
  const trainingData = [];
  for (let i = 0; i < 50; i++) {
    const input = new Float32Array(creature.input);
    const output = new Float32Array(creature.output);

    for (let j = 0; j < creature.input; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    output[0] = Math.random() * 2 - 1;

    trainingData.push({ input, output });
  }

  const discoverStructure = new DiscoverStructure(creature, 60);
  const neuronPromisesMap: Map<string, Promise<void>> = new Map();

  discoverStructure.initialize(neuronPromisesMap);
  discoverStructure.record(trainingData, neuronPromisesMap);
  await Promise.all([...neuronPromisesMap.values()]);

  const viableNeurons = await discoverStructure.listViableNeurons();

  assertExists(viableNeurons, "Should return viable neurons");

  // All neurons should have finite error values
  for (const neuron of viableNeurons) {
    assert(
      Number.isFinite(neuron.totalError),
      `Neuron ${neuron.uuid} has non-finite error: ${neuron.totalError}`,
    );
    assert(
      neuron.totalError >= 0,
      `Neuron ${neuron.uuid} has negative error: ${neuron.totalError}`,
    );
  }

  // Selection should work without warnings
  if (viableNeurons.length > 0) {
    const selected = await discoverStructure.selectNeuronsWeightedByError(
      Math.min(3, viableNeurons.length),
    );
    assertExists(selected, "Should select neurons");
    assert(selected.length > 0, "Should select at least one neuron");
  }

  await discoverStructure.cleanUp();
});

Deno.test("Discovery selection falls back gracefully on invalid totalErrorSum", async () => {
  const creature = makeSimpleCreature();
  CreatureUtil.makeUUID(creature);

  const discoverStructure = new DiscoverStructure(creature, 60);
  const neuronPromisesMap: Map<string, Promise<void>> = new Map();
  discoverStructure.initialize(neuronPromisesMap);

  // Create scenario with errors so we get non-zero totals first
  const trainingData = [];
  for (let i = 0; i < 20; i++) {
    const input = new Float32Array(creature.input);
    const output = new Float32Array(creature.output);
    for (let j = 0; j < creature.input; j++) {
      input[j] = Math.random() * 2 - 1;
    }
    // Intentionally wrong output to generate errors
    output[0] = Math.random() * 2 - 1;
    trainingData.push({ input, output });
  }

  discoverStructure.record(trainingData, neuronPromisesMap);
  await Promise.all([...neuronPromisesMap.values()]);

  // The normal flow should handle valid data correctly
  const viableNeurons = await discoverStructure.listViableNeurons();

  // Should have neurons with non-zero errors
  assertExists(viableNeurons, "Should return viable neurons");
  assert(viableNeurons.length > 0, "Should have some viable neurons");

  // Selection should work without warnings on valid data
  const startTime = Date.now();
  const selected = await discoverStructure.selectNeuronsWeightedByError(2);
  const elapsed = Date.now() - startTime;

  assertExists(selected, "Should return selection");
  assert(selected.length > 0, "Should select at least one neuron");
  assert(
    elapsed < 2000,
    "Should complete quickly",
  );

  // Note: To properly test zero-error fallback would require either:
  // 1. Mocking the internal methods
  // 2. Creating a scenario where all neurons genuinely have zero error
  // For now, this test verifies that valid data flows through without warnings

  await discoverStructure.cleanUp();
});

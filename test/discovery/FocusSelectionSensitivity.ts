import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

function makeSaturatedCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 1 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 1 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("selection penalizes neurons blocked by saturated downstream nodes", async () => {
  const creature = makeSaturatedCreature();
  // Force TypeScript-only mode to ensure we test the fallback logic
  const discover = new DiscoverStructure(creature, 60, 1, {
    isRustDiscoveryEnabled: () => false,
  });

  // Create data where output is saturated (input=100 -> tanh(100)=1)
  // Target is 0, so error is -1.
  // Inverse mapping for hidden-a will be huge (100 -> 0 requires -100 delta).
  // But gradient is 0.
  const trainingData = [
    {
      input: Float32Array.from([100]),
      output: Float32Array.from([0]), // Target
    },
  ];

  const neuronPromisesMap = new Map<string, Promise<void>>();
  // @ts-ignore: private method
  discover.initialize(neuronPromisesMap);
  discover.record(trainingData, neuronPromisesMap);
  await Promise.all(neuronPromisesMap.values());

  // Flush recording to ensure CSVs are written (needed for loadCSV in fallback)
  // In TypeScript mode, record() accumulates in memory but doesn't write CSVs unless initialized with async writes?
  // Actually DiscoverStructure in TS mode writes CSVs directly in Neuron.record if async?
  // No, Neuron.record (TS) calls squashMethod.record or default.
  // Default just updates discoverMap.
  // DiscoverStructure then needs to persist this map to CSVs?
  // DiscoverStructure.record() doesn't flush CSVs.
  // The `initialize` method sets up `neuronPromisesMap` which suggests async writing happens during record via promises?
  // Let's check `Neuron.record`... it populates `discoverMap`.
  // Who writes `discoverMap` to disk?
  // DiscoverStructure.ts doesn't seem to write CSVs from `discoverMap` in `record()` loop?
  // Ah, `loadCSV` reads from disk.
  // If we run in TS mode, `rustAccumulatedNeuronData` is not used?
  // Wait, `DiscoverStructure` seems to rely on `loadCSV` which implies files exist.
  // If we are in TS mode, who writes the files?
  // `Neuron.ts` doesn't write files.

  // We need to manually trigger a write or ensure the test environment handles it.
  // Or maybe we mock `loadCSV`?
  // But `listViableNeuronsFallback` calls `loadCSV`.

  // Let's look at how `listViableNeuronsFallback` gets data.
  // It calls `this.loadCSV`.
  // `loadCSV` checks `parquetFilePath` if Rust is enabled.
  // If Rust is disabled, it tries to read CSV.
  // Who writes the CSV?
  // `Creature.ts` `evolveDir` calls `discoverDir`.

  // In `DiscoverStructure.ts`:
  // `record` -> calls `creature.record`.
  // In TS mode, `creature.record` returns a Map.
  // `DiscoverStructure` accumulates these maps in `rustAccumulatedNeuronData`.
  // But if we are using `isRustDiscoveryEnabled: () => false`, we skip rust accumulation?

  // Wait, `listViableNeuronsFallback` assumes CSVs exist.
  // Where are they created?
  // Perhaps `Neuron.ts` or `DiscoverStructure.ts` writes them?
  // I don't see CSV writing code in the provided snippets.

  // Let's manually persist the recorded data to CSVs for the test.
  // The `discoverMap` is returned by `creature.record`.
  // But `DiscoverStructure.record` discards the return value if not using Rust?
  // No, `const discoverMap = this.creature.record(record.output);`
  // It pushes to `rustAccumulatedNeuronData` ONLY if `usingRustDualWrite`?

  // Actually, looking at `DiscoverStructure.ts`:
  // `public record(...)`
  // `if (!this.usingRustDualWrite || timedOut) return false;`
  // So if Rust is disabled, `record` returns false and DOES NOTHING?

  // If Rust is disabled, `DiscoverStructure` relies on... what?
  // Maybe `initialize` sets up something?
  // `initialize` calls `this.creature.neurons.forEach(...)`.

  // If I want to test `listViableNeuronsFallback` logic, I need to make sure data exists.
  // I will mock `loadCSV` in the test to return the data we want.

  // @ts-ignore: accessing private method to mock
  // deno-lint-ignore require-await
  discover.loadCSV = async (path: string) => {
    console.log(`loadCSV called for ${path}`);
    if (path.includes("hidden-a")) {
      return [{
        activation: 100,
        value: 100,
        errors: [-100], // Huge error from inverse mapping
      }];
    }
    if (path.includes("output-0")) {
      return [{
        activation: 1,
        value: 100, // Saturated input
        errors: [-1],
      }];
    }
    return [];
  };

  const viable = await discover.listViableNeurons(10);
  const hiddenInfo = viable.find((n) => n.uuid === "hidden-a");
  assert(hiddenInfo, "Hidden neuron should be listed");

  console.log("Hidden info:", hiddenInfo);

  // With sensitivity fix, impact should be small.
  // Calculate impact manually to verify expectation:
  // Weight to output is 1.
  // Derivative of output (TANH at 100) is ~0.
  // Impact should be ~0.

  // Currently impact is calculated statically as 1.0.
  // We expect the fix to lower it.
  assert(
    hiddenInfo.impact < 0.1,
    `Impact should be low due to saturation, was ${hiddenInfo.impact}`,
  );
});

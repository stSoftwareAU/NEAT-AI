import { assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { ValidationError } from "../../src/errors/ValidationError.ts";

Deno.test("DiscoverStructure validates creature before Rust export", () => {
  const creature = new Creature(10, 2, { layers: [{ count: 10 }] });
  creature.validate();
  CreatureUtil.makeUUID(creature);

  const hiddenIndex = creature.input;
  creature.neurons[hiddenIndex].uuid = `hidden-${"x".repeat(300)}`;

  const discoverStructure = new DiscoverStructure(creature, 5, 1, {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: () => ({ success: true, temp_dir: "", file: "" }),
    mergeDiscoveryParquet: () => ({ success: true, output_file: "" }),
    analyzeNeurons: () => {
      throw new Error("analyzeNeurons should not run when validation fails");
    },
    analyzeSynapses: () => {
      throw new Error("analyzeSynapses should not run when validation fails");
    },
    readDiscoveryRecords: () => ({ success: true, records: [] }),
  });

  (discoverStructure as unknown as { parquetFilePath: string | null })
    .parquetFilePath = "dummy.parquet";

  const runner = discoverStructure as unknown as {
    runRustNeuronAnalysis(focusList: string[]): void;
  };

  assertThrows(
    () => runner.runRustNeuronAnalysis(["hidden-0"]),
    ValidationError,
    "UUID",
  );
});

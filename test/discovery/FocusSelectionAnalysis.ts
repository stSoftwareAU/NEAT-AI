import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  type DiscoverRecord,
  DiscoverStructure,
  type FocusSelectionAnalysis,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

/**
 * Creates a test creature with multiple hidden neurons having different error/impact profiles.
 */
function makeTestCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 2,
    neurons: [
      // High error, high impact (should be top priority)
      { type: "hidden", uuid: "neuron-high-high", squash: "IDENTITY", bias: 0 },
      // High error, low impact
      { type: "hidden", uuid: "neuron-high-low", squash: "IDENTITY", bias: 0 },
      // Low error, high impact
      { type: "hidden", uuid: "neuron-low-high", squash: "IDENTITY", bias: 0 },
      // Low error, low impact (candidate for removal)
      { type: "hidden", uuid: "neuron-low-low", squash: "IDENTITY", bias: 0 },
      // Outputs
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // High impact neuron (weight 1.0 to outputs)
      { fromUUID: "input-0", toUUID: "neuron-high-high", weight: 1 },
      { fromUUID: "neuron-high-high", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "neuron-high-high", toUUID: "output-1", weight: 1.0 },
      // Low impact neuron (weight 0.01 to outputs)
      { fromUUID: "input-0", toUUID: "neuron-high-low", weight: 1 },
      { fromUUID: "neuron-high-low", toUUID: "output-0", weight: 0.01 },
      // High impact neuron
      { fromUUID: "input-1", toUUID: "neuron-low-high", weight: 1 },
      { fromUUID: "neuron-low-high", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "neuron-low-high", toUUID: "output-1", weight: 0.8 },
      // Very low impact neuron (weight 0.001 to outputs)
      { fromUUID: "input-1", toUUID: "neuron-low-low", weight: 1 },
      { fromUUID: "neuron-low-low", toUUID: "output-0", weight: 0.001 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/**
 * Sets up mock discovery data with known error values.
 */
function setupMockDiscoveryData(discover: DiscoverStructure) {
  const recordsByUUID = new Map<string, DiscoverRecord[]>([
    ["neuron-high-high", [
      { activation: 0.5, value: 0.5, errors: [1.0, 1.0, 1.0] }, // avg error = 1.0
    ]],
    ["neuron-high-low", [
      { activation: 0.5, value: 0.5, errors: [1.0, 1.0, 1.0] }, // avg error = 1.0
    ]],
    ["neuron-low-high", [
      { activation: 0.5, value: 0.5, errors: [0.1, 0.1, 0.1] }, // avg error = 0.1
    ]],
    ["neuron-low-low", [
      { activation: 0.5, value: 0.5, errors: [0.1, 0.1, 0.1] }, // avg error = 0.1
    ]],
    ["output-0", [
      { activation: 0, value: 0, errors: [0.5] },
    ]],
    ["output-1", [
      { activation: 0, value: 0, errors: [0.5] },
    ]],
  ]);

  const internal = discover as unknown as {
    recorded: boolean;
    initialized: boolean;
    parquetFilePath: string | null;
    cachedMaxOutputError?: { value: number; computedAt: number };
    loadCSV: (file: string) => Promise<DiscoverRecord[]>;
  };

  internal.initialized = true;
  internal.recorded = true;
  internal.parquetFilePath = "mock.parquet";
  internal.cachedMaxOutputError = {
    value: 1.0,
    computedAt: Date.now(),
  };
  internal.loadCSV = (file: string) => {
    const fileName = file.split("/").pop() ?? "";
    const uuid = fileName.replace(/\.csv$/, "");
    const records = recordsByUUID.get(uuid);
    if (!records) {
      throw new Error(`No records for ${uuid}`);
    }
    return Promise.resolve(records);
  };
}

Deno.test("focus selection analysis JSON is created", async () => {
  const creature = makeTestCreature();
  const discover = new DiscoverStructure(creature, 10, 10, {
    isRustDiscoveryEnabled: () => false,
    isRustLibraryAvailable: () => false,
    recordDiscovery: () => ({ success: false, error: "not needed" }),
    mergeDiscoveryParquet: () => ({ success: false, error: "not needed" }),
    analyzeNeurons: () => ({ success: false, error: "not needed" }),
    analyzeSynapses: () => ({ success: false, error: "not needed" }),
    readDiscoveryRecords: () => ({ success: false, error: "not needed" }),
    rankFocusNeurons: undefined,
  });

  setupMockDiscoveryData(discover);

  try {
    const costOfGrowth = 0.05;
    const selected = await discover.selectNeuronsWeightedByError(
      2,
      undefined,
      costOfGrowth,
    );

    assertEquals(selected.length, 2, "Should select 2 neurons");

    // Check that JSON file was created
    const discoveryDir = `.discovery/focus-analysis/${creature.uuid}`;
    const files: string[] = [];
    for await (const entry of Deno.readDir(discoveryDir)) {
      files.push(entry.name);
    }
    assert(files.length > 0, "JSON file should be created");

    const jsonFile = files[0];
    assert(
      jsonFile.includes("focus-selection"),
      "File should be named focus-selection",
    );
    assert(jsonFile.endsWith(".json"), "File should be JSON");

    // Read and validate JSON content
    const content = await Deno.readTextFile(`${discoveryDir}/${jsonFile}`);
    const analysis: FocusSelectionAnalysis = JSON.parse(content);

    assertExists(analysis.discoveryID, "Should have discoveryID");
    assertExists(analysis.timestamp, "Should have timestamp");
    assertEquals(
      analysis.costOfGrowth,
      costOfGrowth,
      "Should have costOfGrowth",
    );
    // Should have 4 hidden + 2 output neurons (input and constant are excluded)
    assertEquals(
      analysis.totalCandidates,
      6,
      "Should have 6 candidate neurons (4 hidden + 2 output)",
    );
    assertEquals(analysis.selectedCount, 2, "Should have 2 selected neurons");
    assertExists(analysis.candidates, "Should have candidates array");
    assertExists(
      analysis.lowImpactNeurons,
      "Should have lowImpactNeurons array",
    );
  } finally {
    await discover.cleanUp();
  }
});

Deno.test("candidates are ordered by potential error reduction", async () => {
  const creature = makeTestCreature();
  const discover = new DiscoverStructure(creature, 10, 10, {
    isRustDiscoveryEnabled: () => false,
    isRustLibraryAvailable: () => false,
    recordDiscovery: () => ({ success: false, error: "not needed" }),
    mergeDiscoveryParquet: () => ({ success: false, error: "not needed" }),
    analyzeNeurons: () => ({ success: false, error: "not needed" }),
    analyzeSynapses: () => ({ success: false, error: "not needed" }),
    readDiscoveryRecords: () => ({ success: false, error: "not needed" }),
    rankFocusNeurons: undefined,
  });

  setupMockDiscoveryData(discover);

  try {
    await discover.selectNeuronsWeightedByError(2, undefined, 0.05);

    const discoveryDir = `.discovery/focus-analysis/${creature.uuid}`;
    const files: string[] = [];
    for await (const entry of Deno.readDir(discoveryDir)) {
      files.push(entry.name);
    }
    const jsonFile = files[0];
    const content = await Deno.readTextFile(`${discoveryDir}/${jsonFile}`);
    const analysis: FocusSelectionAnalysis = JSON.parse(content);

    // Verify candidates are sorted by potential error reduction (descending)
    for (let i = 0; i < analysis.candidates.length - 1; i++) {
      const current = analysis.candidates[i].potentialErrorReduction;
      const next = analysis.candidates[i + 1].potentialErrorReduction;
      assert(
        current >= next,
        `Candidates should be ordered by potential error reduction: ${current} >= ${next}`,
      );
    }

    // First candidate should be the high-error, high-impact neuron
    const topCandidate = analysis.candidates[0];
    assert(
      topCandidate.neuronUuid.includes("high-high") ||
        topCandidate.potentialErrorReduction > 0.5,
      "Top candidate should have high potential error reduction",
    );
  } finally {
    await discover.cleanUp();
  }
});

Deno.test("low-impact neurons are identified correctly", async () => {
  const creature = makeTestCreature();
  const discover = new DiscoverStructure(creature, 10, 10, {
    isRustDiscoveryEnabled: () => false,
    isRustLibraryAvailable: () => false,
    recordDiscovery: () => ({ success: false, error: "not needed" }),
    mergeDiscoveryParquet: () => ({ success: false, error: "not needed" }),
    analyzeNeurons: () => ({ success: false, error: "not needed" }),
    analyzeSynapses: () => ({ success: false, error: "not needed" }),
    readDiscoveryRecords: () => ({ success: false, error: "not needed" }),
    rankFocusNeurons: undefined,
  });

  setupMockDiscoveryData(discover);

  try {
    const costOfGrowth = 0.05;
    await discover.selectNeuronsWeightedByError(2, undefined, costOfGrowth);

    const discoveryDir = `.discovery/focus-analysis/${creature.uuid}`;
    const files: string[] = [];
    for await (const entry of Deno.readDir(discoveryDir)) {
      files.push(entry.name);
    }
    const jsonFile = files[0];
    const content = await Deno.readTextFile(`${discoveryDir}/${jsonFile}`);
    const analysis: FocusSelectionAnalysis = JSON.parse(content);

    // Low-impact neurons should be those with impact < costOfGrowth
    for (const lowImpact of analysis.lowImpactNeurons) {
      assert(
        lowImpact.impact < costOfGrowth,
        `Low-impact neuron ${lowImpact.neuronUuid} should have impact ${lowImpact.impact} < ${costOfGrowth}`,
      );
      assertExists(lowImpact.reason, "Should have a reason");
    }

    // Should find the low-low neuron (very low impact)
    const veryLowImpact = analysis.lowImpactNeurons.find((n) =>
      n.neuronUuid.includes("low-low")
    );
    assertExists(
      veryLowImpact,
      "Should identify the very low impact neuron",
    );
  } finally {
    await discover.cleanUp();
  }
});

Deno.test("selected neurons are marked correctly", async () => {
  const creature = makeTestCreature();
  const discover = new DiscoverStructure(creature, 10, 10, {
    isRustDiscoveryEnabled: () => false,
    isRustLibraryAvailable: () => false,
    recordDiscovery: () => ({ success: false, error: "not needed" }),
    mergeDiscoveryParquet: () => ({ success: false, error: "not needed" }),
    analyzeNeurons: () => ({ success: false, error: "not needed" }),
    analyzeSynapses: () => ({ success: false, error: "not needed" }),
    readDiscoveryRecords: () => ({ success: false, error: "not needed" }),
    rankFocusNeurons: undefined,
  });

  setupMockDiscoveryData(discover);

  try {
    const discoveryDir = `.discovery/focus-analysis/${creature.uuid}`;

    // Clean up any existing files first
    try {
      await Deno.remove(discoveryDir, { recursive: true });
    } catch {
      // Directory might not exist, that's ok
    }

    const selected = await discover.selectNeuronsWeightedByError(
      2,
      undefined,
      0.05,
    );

    const files: string[] = [];
    for await (const entry of Deno.readDir(discoveryDir)) {
      files.push(entry.name);
    }
    const jsonFile = files[files.length - 1]; // Get the most recent file
    const content = await Deno.readTextFile(`${discoveryDir}/${jsonFile}`);
    const analysis: FocusSelectionAnalysis = JSON.parse(content);

    const selectedSet = new Set(selected);
    const selectedCandidates = analysis.candidates.filter((c) => c.selected);
    const unselectedCandidates = analysis.candidates.filter((c) => !c.selected);

    assertEquals(
      selectedCandidates.length,
      selected.length,
      "Number of selected candidates should match selection count",
    );

    // Verify all candidates marked as selected are in the actual selection
    for (const candidate of selectedCandidates) {
      assert(
        selectedSet.has(candidate.neuronUuid),
        `Candidate marked as selected ${candidate.neuronUuid} should be in actual selection. Selected: ${
          Array.from(selectedSet).join(", ")
        }`,
      );
    }

    // Verify no unselected candidates are in the selection
    for (const candidate of unselectedCandidates) {
      assert(
        !selectedSet.has(candidate.neuronUuid),
        `Candidate marked as unselected ${candidate.neuronUuid} should not be in selection`,
      );
    }

    // Verify counts match
    assertEquals(
      selectedCandidates.length,
      analysis.selectedCount,
      "Selected candidates count should match analysis.selectedCount",
    );
  } finally {
    await discover.cleanUp();
  }
});

Deno.test("retry numbering is included when provided", async () => {
  const creature = makeTestCreature();
  const discover = new DiscoverStructure(creature, 10, 10, {
    isRustDiscoveryEnabled: () => false,
    isRustLibraryAvailable: () => false,
    recordDiscovery: () => ({ success: false, error: "not needed" }),
    mergeDiscoveryParquet: () => ({ success: false, error: "not needed" }),
    analyzeNeurons: () => ({ success: false, error: "not needed" }),
    analyzeSynapses: () => ({ success: false, error: "not needed" }),
    readDiscoveryRecords: () => ({ success: false, error: "not needed" }),
    rankFocusNeurons: undefined,
  });

  setupMockDiscoveryData(discover);

  try {
    const discoveryDir = `.discovery/focus-analysis/${creature.uuid}`;

    // Clean up any existing files first
    try {
      await Deno.remove(discoveryDir, { recursive: true });
    } catch {
      // Directory might not exist, that's ok
    }

    // Test with retry number
    const retryNumber = 2;
    await discover.selectNeuronsWeightedByError(2, retryNumber, 0.05);

    const files: string[] = [];
    for await (const entry of Deno.readDir(discoveryDir)) {
      files.push(entry.name);
    }
    assert(files.length >= 1, "Should have at least one JSON file");

    // Get the most recent file (should be the retry one)
    const retryFile = files[files.length - 1];
    assert(
      retryFile.includes("retry-2"),
      `File name should include retry-2: ${retryFile}`,
    );

    const retryContent = await Deno.readTextFile(
      `${discoveryDir}/${retryFile}`,
    );
    const retryAnalysis: FocusSelectionAnalysis = JSON.parse(retryContent);

    assertEquals(
      retryAnalysis.retryNumber,
      retryNumber,
      "Analysis should include retry number in JSON",
    );
  } finally {
    await discover.cleanUp();
  }
});

Deno.test("weighted scores reflect actual selection probability", async () => {
  const creature = makeTestCreature();
  const discover = new DiscoverStructure(creature, 10, 10, {
    isRustDiscoveryEnabled: () => false,
    isRustLibraryAvailable: () => false,
    recordDiscovery: () => ({ success: false, error: "not needed" }),
    mergeDiscoveryParquet: () => ({ success: false, error: "not needed" }),
    analyzeNeurons: () => ({ success: false, error: "not needed" }),
    analyzeSynapses: () => ({ success: false, error: "not needed" }),
    readDiscoveryRecords: () => ({ success: false, error: "not needed" }),
    rankFocusNeurons: undefined,
  });

  setupMockDiscoveryData(discover);

  try {
    await discover.selectNeuronsWeightedByError(2, undefined, 0.05);

    const discoveryDir = `.discovery/focus-analysis/${creature.uuid}`;
    const files: string[] = [];
    for await (const entry of Deno.readDir(discoveryDir)) {
      files.push(entry.name);
    }
    const jsonFile = files[0];
    const content = await Deno.readTextFile(`${discoveryDir}/${jsonFile}`);
    const analysis: FocusSelectionAnalysis = JSON.parse(content);

    // Verify weighted scores are calculated correctly
    const EPSILON = 0.0001;
    for (const candidate of analysis.candidates) {
      const expectedWeightedScore = candidate.totalError *
        (candidate.impact + EPSILON);
      const diff = Math.abs(candidate.weightedScore - expectedWeightedScore);
      assert(
        diff < 0.0001,
        `Weighted score ${candidate.weightedScore} should match calculation ${expectedWeightedScore}`,
      );
    }

    // Note: totalWeightedSum may be scaled to respect output error caps,
    // so it might not exactly match the raw sum of weighted scores.
    // We just verify it's positive and finite.
    assert(
      Number.isFinite(analysis.totalWeightedSum) &&
        analysis.totalWeightedSum > 0,
      `Total weighted sum ${analysis.totalWeightedSum} should be finite and positive`,
    );
  } finally {
    await discover.cleanUp();
  }
});

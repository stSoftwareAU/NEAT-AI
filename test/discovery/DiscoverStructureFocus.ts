import { assert } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  type DiscoverRecord,
  DiscoverStructure,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Activations } from "../../src/methods/activations/Activations.ts";
import type { ActivationInterface } from "../../src/methods/activations/ActivationInterface.ts";

function makeFocusCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-saturated", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "hidden-linear", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-saturated", weight: 1 },
      { fromUUID: "hidden-saturated", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-0", toUUID: "hidden-linear", weight: 1 },
      { fromUUID: "hidden-linear", toUUID: "output-0", weight: 1 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("focus ranking scales neuron error by activation effect", async () => {
  const creature = makeFocusCreature();
  const discover = new DiscoverStructure(
    creature,
    10,
    10,
    {
      isRustDiscoveryEnabled: () => false,
      isRustLibraryAvailable: () => false,
      recordDiscovery: () => ({
        success: false,
        error: "not needed",
      }),
      mergeDiscoveryParquet: () => ({
        success: false,
        error: "not needed",
      }),
      analyzeNeurons: () => ({
        success: false,
        error: "not needed",
      }),
      analyzeSynapses: () => ({
        success: false,
        error: "not needed",
      }),
      readDiscoveryRecords: () => ({
        success: false,
        error: "not needed",
      }),
      rankFocusNeurons: undefined,
    },
  );

  const tanh = Activations.find("TANH") as ActivationInterface;
  const saturatedValue = 1_000_000;
  const saturatedActivation = tanh.squash(saturatedValue);

  const recordsByUUID = new Map<string, DiscoverRecord[]>([
    ["hidden-saturated", [{
      activation: saturatedActivation,
      value: saturatedValue,
      errors: [1_000_000],
    }]],
    ["hidden-linear", [{
      activation: 0,
      value: 0,
      errors: [0.2],
    }]],
    ["output-0", [{
      activation: 0,
      value: 0,
      errors: [0.1],
    }]],
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
    value: 1,
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

  try {
    const neurons = await discover.listViableNeurons(3);
    const linear = neurons.find((entry) => entry.uuid === "hidden-linear");
    const saturated = neurons.find((entry) =>
      entry.uuid === "hidden-saturated"
    );
    assert(linear, "linear neuron should be included in ranking");
    assert(
      (linear?.totalError ?? 0) > (saturated?.totalError ?? 0),
      "Linear neuron should outrank saturated neuron once activation deltas are considered.",
    );
  } finally {
    await discover.cleanUp();
  }
});

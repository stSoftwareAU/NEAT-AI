/**
 * The analysis methods await an asynchronous `analyzeParallel` and never run two
 * native analyses at once (Issue #4126).
 *
 * `analyze_parallel` is a non-blocking FFI call, so `runParallelAnalysis`'s
 * fan-out no longer queues behind a parked thread. These cases drive the three
 * Rust-backed analysis methods through `DiscoverStructure` with an
 * asynchronous `analyzeParallel` double: each method must return what the
 * awaited analysis produced, and a concurrent fan-out must reach the double one
 * call at a time, with later calls served from the cache the first populated.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  DiscoverStructure,
  type DiscoverStructureDeps,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type {
  RustCandidateNeuron,
  RustCandidateSynapse,
  RustParallelAnalysisInput,
  RustParallelAnalysisResult,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import { initWasmForTests } from "../_initWasm.ts";
import { DiscoveryLibraryLifetime } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryLibraryLifetime.ts";

function makeCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "output-0", weight: -0.25 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

const HELPFUL_SYNAPSE: RustCandidateSynapse = {
  fromNeuronUuid: "input-1",
  toNeuronUuid: "hidden-1",
  weight: 0.3,
  targetNeuronImpact: 1.0,
  expectedCreatureErrorReduction: 0,
  expectedCreatureScoreGain: 0.5,
  improvedCount: 5,
  totalCount: 10,
};

const HARMFUL_SYNAPSE: RustCandidateSynapse = {
  fromNeuronUuid: "input-0",
  toNeuronUuid: "hidden-1",
  weight: 0.5,
  targetNeuronImpact: 1.0,
  expectedCreatureErrorReduction: 0.4,
  expectedCreatureScoreGain: -0.4,
  improvedCount: 6,
  totalCount: 10,
};

const HELPFUL_NEURON: RustCandidateNeuron = {
  sourceNeuronUuid: "input-0",
  targetNeuronUuid: "output-0",
  squash: "TANH",
  bias: 0,
  incomingWeight: 0.5,
  outgoingWeight: 0.3,
  targetNeuronImpact: 1.0,
  expectedCreatureErrorReduction: 0,
  expectedCreatureScoreGain: 0.8,
  improvedCount: 8,
  totalCount: 10,
};

function runtimeIdForUuid(creature: Creature, uuid: string): number {
  const id = creature.neurons.find((neuron) => neuron.uuid === uuid)?.id;
  if (typeof id !== "number") {
    throw new Error(`Missing runtime id for ${uuid}`);
  }
  return id;
}

/** Lets the event loop turn once so an overlapping call could interleave. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 5));
}

function makeDeps(
  analyzeParallel: (
    input: RustParallelAnalysisInput,
  ) => Promise<RustParallelAnalysisResult>,
): DiscoverStructureDeps {
  return {
    isRustDiscoveryEnabled: () => true,
    isRustLibraryAvailable: () => true,
    recordDiscovery: () => ({ success: true, file: "chunk.parquet" }),
    mergeDiscoveryParquet: () => ({
      success: true,
      outputFile: "merged.parquet",
    }),
    analyzeParallel,
    readDiscoveryRecords: () => ({ success: true, records: [] }),
  };
}

async function withStructure(
  creature: Creature,
  analyzeParallel: (
    input: RustParallelAnalysisInput,
  ) => Promise<RustParallelAnalysisResult>,
  body: (structure: DiscoverStructure) => Promise<void>,
): Promise<void> {
  const structure = new DiscoverStructure(
    creature,
    60,
    100,
    makeDeps(analyzeParallel),
  );
  const neuronPromises = new Map<number, Promise<void>>();
  try {
    structure.initialize(neuronPromises);
    const trainingRecords: DataRecordInterface[] = [];
    for (let i = 0; i < 10; i++) {
      trainingRecords.push({
        input: Float32Array.from([i / 10, (i + 1) / 10]),
        output: Float32Array.from([i / 5]),
      });
    }
    structure.record(trainingRecords, neuronPromises);
    structure.flushRustRecording();
    await body(structure);
  } finally {
    await structure.cleanUp();
  }
}

const SUCCESS: RustParallelAnalysisResult = {
  success: true,
  helpfulNeurons: [HELPFUL_NEURON],
  helpfulSynapses: [HELPFUL_SYNAPSE],
  harmfulSynapses: [HARMFUL_SYNAPSE],
};

async function delayedSuccess(): Promise<RustParallelAnalysisResult> {
  await yieldToEventLoop();
  return SUCCESS;
}

Deno.test("analyzeSelectedNeurons returns the candidates of an asynchronous analysis (Issue #4126)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const hiddenId = runtimeIdForUuid(creature, "hidden-1");
  await withStructure(creature, delayedSuccess, async (structure) => {
    const candidates = await structure.analyzeSelectedNeurons([hiddenId]);
    assert(candidates !== undefined, "the awaited analysis must be read");
    assertEquals(candidates.length, 1);
  });
});

Deno.test("analyzeMissingNeurons returns the candidates of an asynchronous analysis (Issue #4126)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const outputId = runtimeIdForUuid(creature, "output-0");
  await withStructure(creature, delayedSuccess, async (structure) => {
    const candidates = await structure.analyzeMissingNeurons([outputId]);
    assert(candidates !== undefined, "the awaited analysis must be read");
    assertEquals(candidates.length, 1);
  });
});

Deno.test("analyzeSelectedNeuronsForRemoval returns the candidate of an asynchronous analysis (Issue #4126)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const hiddenId = runtimeIdForUuid(creature, "hidden-1");
  await withStructure(creature, delayedSuccess, async (structure) => {
    const candidate = await structure.analyzeSelectedNeuronsForRemoval([
      hiddenId,
    ]);
    assert(candidate !== undefined, "the awaited analysis must be read");
  });
});

Deno.test("a concurrent fan-out of the analysis methods runs one native analysis at a time (Issue #4126)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const hiddenId = runtimeIdForUuid(creature, "hidden-1");
  let inFlight = 0;
  let maxInFlight = 0;
  const requested: { synapse: boolean; neuron: boolean }[] = [];

  await withStructure(
    creature,
    async (input) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      requested.push({
        synapse: input.maxSynapseCandidates !== undefined,
        neuron: input.maxNeuronCandidates !== undefined,
      });
      try {
        return await delayedSuccess();
      } finally {
        inFlight--;
      }
    },
    async (structure) => {
      // The same fan-out `runParallelAnalysis` starts when the combined
      // analysis returned nothing: neuron-only, synapse-only, synapse-only.
      const [neurons, synapses, harmful] = await Promise.all([
        structure.analyzeMissingNeurons([hiddenId]),
        structure.analyzeSelectedNeurons([hiddenId]),
        structure.analyzeSelectedNeuronsForRemoval([hiddenId]),
      ]);

      assertEquals(maxInFlight, 1, "native analyses must not overlap");
      assertEquals(
        requested,
        [
          { synapse: false, neuron: true },
          { synapse: true, neuron: false },
        ],
        "the removal analysis must reuse the synapse analysis's cache",
      );
      assert(neurons !== undefined);
      assert(synapses !== undefined);
      assert(harmful !== undefined);
    },
  );
});

Deno.test("a failed native analysis does not stop the queued analyses (Issue #4126)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const hiddenId = runtimeIdForUuid(creature, "hidden-1");
  let calls = 0;

  await withStructure(
    creature,
    async () => {
      calls++;
      await yieldToEventLoop();
      if (calls === 1) {
        throw new Error("native analysis failed");
      }
      return SUCCESS;
    },
    async (structure) => {
      const first = structure.analyzeSelectedNeurons([hiddenId]);
      const second = structure.analyzeMissingNeurons([hiddenId]);
      let rejected: unknown;
      try {
        await first;
      } catch (error) {
        rejected = error;
      }
      assert(rejected instanceof Error, "the first caller sees the failure");
      const neurons = await second;
      assertEquals(calls, 2, "the queued analysis still ran");
      assert(neurons !== undefined);
    },
  );
});

Deno.test("cleanup preserves the discovery directory until queued analyses settle (Issue #4126)", async () => {
  await initWasmForTests();
  const creature = makeCreature();
  const hiddenId = runtimeIdForUuid(creature, "hidden-1");
  let release!: (result: RustParallelAnalysisResult) => void;
  let started!: () => void;
  const pending = new Promise<RustParallelAnalysisResult>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => started = resolve);
  let removed = false;
  const structure = new DiscoverStructure(creature, 60, 100, {
    ...makeDeps(() => {
      started();
      return pending;
    }),
    removeTempDir: async (dir) => {
      removed = true;
      await Deno.remove(dir, { recursive: true });
    },
  });
  const neuronPromises = new Map<number, Promise<void>>();
  structure.initialize(neuronPromises);
  structure.record([{
    input: Float32Array.from([0.1, 0.2]),
    output: Float32Array.from([0.3]),
  }], neuronPromises);
  structure.flushRustRecording();
  const analysis = structure.analyzeSelectedNeurons([hiddenId]);
  await entered;
  const cleanup = structure.cleanUp();
  try {
    // Let cleanup progress through its asynchronous steps.
    await yieldToEventLoop();
    assertEquals(removed, false);
  } finally {
    release(SUCCESS);
    await Promise.all([analysis, cleanup]);
  }
  assertEquals(removed, true);
});

Deno.test("cleanup defers shared library close until another discovery finishes (Issue #4126)", async () => {
  await initWasmForTests();
  let closed = 0;
  const lifetime = new DiscoveryLibraryLifetime(() => closed++);
  let release!: (result: RustParallelAnalysisResult) => void;
  let started!: () => void;
  const pending = new Promise<RustParallelAnalysisResult>((resolve) =>
    release = resolve
  );
  const entered = new Promise<void>((resolve) => started = resolve);
  const creatureA = makeCreature();
  const creatureB = makeCreature();
  const baseA = await Deno.makeTempDir();
  const baseB = await Deno.makeTempDir();
  const deps = {
    ...makeDeps(() =>
      lifetime.run(async () => {
        started();
        return await pending;
      })
    ),
    closeRustLibrary: () => lifetime.close(),
  };
  const a = new DiscoverStructure(creatureA, 60, 100, deps, {
    baseDirectory: baseA,
  });
  const b = new DiscoverStructure(creatureB, 60, 100, deps, {
    baseDirectory: baseB,
  });
  const promises = new Map<number, Promise<void>>();
  a.initialize(promises);
  b.initialize(promises);
  b.record([{
    input: Float32Array.from([0.1, 0.2]),
    output: Float32Array.from([0.3]),
  }], promises);
  b.flushRustRecording();
  const analysis = b.analyzeSelectedNeurons([
    runtimeIdForUuid(creatureB, "hidden-1"),
  ]);
  await entered;
  try {
    await a.cleanUp();
    assertEquals(closed, 0);
  } finally {
    release(SUCCESS);
    await analysis;
    await b.cleanUp();
    await Deno.remove(baseA, { recursive: true });
    await Deno.remove(baseB, { recursive: true });
  }
  assertEquals(closed, 2);
});

Deno.test("a requested library close waits for all analyses, including failures", async () => {
  let closed = 0;
  const lifetime = new DiscoveryLibraryLifetime(() => closed++);
  let finish!: () => void;
  let fail!: (reason: Error) => void;
  const first = lifetime.run(() =>
    new Promise<void>((resolve) => finish = resolve)
  );
  const second = lifetime.run(() =>
    new Promise<void>((_resolve, reject) => fail = reject)
  );
  lifetime.close();
  finish();
  await first;
  assertEquals(closed, 0);
  fail(new Error("analysis failed"));
  try {
    await second;
    throw new Error("expected rejection");
  } catch (error) {
    assertEquals((error as Error).message, "analysis failed");
  }
  assertEquals(closed, 1);
});

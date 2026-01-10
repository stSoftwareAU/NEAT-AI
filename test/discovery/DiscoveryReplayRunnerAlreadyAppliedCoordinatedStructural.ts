import { assertEquals } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { DiscoveryReplayRunner } from "../../src/discovery/DiscoveryReplayRunner.ts";
import type { SuccessCacheEntry } from "../../src/discovery/SuccessCache.ts";

Deno.test(
  "DiscoveryReplayRunner skips coordinated-structural entries that already appear applied",
  async () => {
    const baseExport: CreatureExport = {
      input: 1,
      output: 1,
      forwardOnly: true,
      neurons: [
        { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        // Already at the post-candidate weight.
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.02 },
      ],
    };
    const base = Creature.fromJSON(baseExport);
    base.uuid = "base";

    const coordinatedEntry: SuccessCacheEntry = {
      key: "coordinated-structural_deadbeef",
      changeType: "coordinated-structural",
      originalScore: 0.5,
      candidateScore: 0.6,
      scoreDelta: 0.1,
      error: 0.4,
      originalError: 0.5,
      timestamp: new Date().toISOString(),
      rustRequest: {
        coordinatedStructuralCandidate: {
          operations: [
            {
              type: "removeSynapse",
              fromNeuronUuid: "input-0",
              toNeuronUuid: "output-0",
            },
            {
              type: "addSynapse",
              fromNeuronUuid: "input-0",
              toNeuronUuid: "output-0",
              weight: 0.02,
            },
          ],
          expectedCreatureScoreGain: 0.001,
        },
      },
    };

    const runner = new DiscoveryReplayRunner({
      listEntries: (_dir) => [coordinatedEntry],
      // Fail fast if we accidentally try to apply/evaluate.
      applyEntry: () => {
        throw new Error("applyEntry should not be called for already-applied");
      },
      evaluateError: (creature) => {
        // Replay always evaluates the baseline creature once.
        if (creature.uuid === "base") {
          return Promise.resolve({ error: 0, score: 0.5 });
        }
        throw new Error(
          "evaluateError should not be called for already-applied candidate creatures",
        );
      },
    });

    const result = await runner.replayDir({
      creature: base,
      dataDir: "/tmp/does-not-matter",
      options: {
        discoverySuccessCacheDir: "/tmp/does-not-matter",
        costOfGrowth: 0,
        discoveryReplayMaxSingles: 10,
        discoveryReplayMaxPairwise: 10,
        discoveryReplayMaxTriples: 10,
        threads: 1,
      },
    });

    assertEquals(result.skippedAlreadyApplied, 1);
    assertEquals(result.evaluatedSingles, 0);
  },
);

Deno.test(
  "DiscoveryReplayRunner skips coordinated-structural entries with setWeight that already appear applied",
  async () => {
    const baseExport: CreatureExport = {
      input: 1,
      output: 1,
      forwardOnly: true,
      neurons: [
        { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
        { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
      ],
      synapses: [
        // Already at the post-candidate weight.
        { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.006 },
        { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      ],
    };
    const base = Creature.fromJSON(baseExport);
    base.uuid = "base";

    const coordinatedEntry: SuccessCacheEntry = {
      key: "coordinated-structural_setweight",
      changeType: "coordinated-structural",
      originalScore: 0.5,
      candidateScore: 0.6,
      scoreDelta: 0.1,
      error: 0.4,
      originalError: 0.5,
      timestamp: new Date().toISOString(),
      rustRequest: {
        coordinatedStructuralCandidate: {
          operations: [
            {
              type: "setWeight",
              fromNeuronUuid: "input-0",
              toNeuronUuid: "hidden-0",
              weight: 0.006,
            },
          ],
          expectedCreatureScoreGain: 0.001,
          comment: "Adjust synapse weight: old=-0.001, new=0.006, delta=0.007",
        },
      },
    };

    const runner = new DiscoveryReplayRunner({
      listEntries: (_dir) => [coordinatedEntry],
      // Fail fast if we accidentally try to apply/evaluate.
      applyEntry: () => {
        throw new Error("applyEntry should not be called for already-applied");
      },
      evaluateError: (creature) => {
        // Replay always evaluates the baseline creature once.
        if (creature.uuid === "base") {
          return Promise.resolve({ error: 0, score: 0.5 });
        }
        throw new Error(
          "evaluateError should not be called for already-applied candidate creatures",
        );
      },
    });

    const result = await runner.replayDir({
      creature: base,
      dataDir: "/tmp/does-not-matter",
      options: {
        discoverySuccessCacheDir: "/tmp/does-not-matter",
        costOfGrowth: 0,
        discoveryReplayMaxSingles: 10,
        discoveryReplayMaxPairwise: 10,
        discoveryReplayMaxTriples: 10,
        threads: 1,
      },
    });

    assertEquals(result.skippedAlreadyApplied, 1);
    assertEquals(result.evaluatedSingles, 0);
  },
);

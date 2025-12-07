/**
 * Tests for discovery message formatting improvements.
 * - Neuron UUIDs should use shortID format
 * - Messages should not duplicate change type information
 * - Messages should not include redundant creature short ID
 *
 * @module test/discovery/DiscoveryMessageFormatting
 */

/* cspell:disable-next-line */
// cspell:ignore ghij klmnopqrstuv ghijklmnopqr

import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { DiscoverResult } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Creature } from "../../src/Creature.ts";
import type { DiscoveryRunnerWorker } from "../../src/discovery/DiscoveryRunner.ts";
import { DiscoveryRunner } from "../../src/discovery/DiscoveryRunner.ts";
import { shortID } from "../../src/discovery/DiscoveryCandidates.ts";

function makeOptions(overrides: Partial<NeatOptions> = {}): NeatOptions {
  return {
    iterations: 1,
    creatureStore: "/tmp/store",
    threads: 1,
    costOfGrowth: 1e-10,
    ...overrides,
  } as NeatOptions;
}

// Helper to create a base creature with a removable hidden neuron
function makeCreatureWithRemovableNeuron(neuronUUID: string) {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: neuronUUID, squash: "IDENTITY", bias: 0.001 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: neuronUUID, weight: 0.0001 },
      { fromUUID: neuronUUID, toUUID: "output-0", weight: 0.0001 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

class FakeWorker implements DiscoveryRunnerWorker {
  #discoverResult: DiscoverResult;
  #computeError: (creature: Creature) => number;
  #baseNeuronCount: number;

  constructor(
    discoverResult: DiscoverResult,
    computeError: (creature: Creature) => number,
    baseNeuronCount: number,
  ) {
    this.#discoverResult = discoverResult;
    this.#computeError = computeError;
    this.#baseNeuronCount = baseNeuronCount;
  }

  discover(
    _creature: Creature,
    _options: NeatOptions,
  ): Promise<Awaited<ReturnType<DiscoveryRunnerWorker["discover"]>>> {
    return Promise.resolve({
      taskID: 1,
      duration: 10,
      discover: this.#discoverResult,
    });
  }

  evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<Awaited<ReturnType<DiscoveryRunnerWorker["evaluate"]>>> {
    const error = this.#computeError(creature);
    const json = creature.exportJSON();
    // Removal candidates get better scores (lower error after complexity adjustment)
    const isRemoval = json.neurons.length < this.#baseNeuronCount;
    const adjustedError = isRemoval ? error * 0.8 : error;
    return Promise.resolve({
      taskID: 2,
      duration: 5,
      evaluate: {
        error: adjustedError,
      },
    });
  }

  terminate(): void {}
}

Deno.test(
  "Discovery message uses shortID for remove-low-impact neuron UUID",
  async () => {
    const fullUUID = "3e979317-989f-4c5c-8272-02fd85be94a8";
    const expectedShortID = shortID(fullUUID); // Should be "85be94a8"
    const baseCreature = makeCreatureWithRemovableNeuron(fullUUID);
    const baseNeuronCount = baseCreature.exportJSON().neurons.length;

    const discoveryResult: DiscoverResult = {
      ID: "MSG-FORMAT-TEST",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: [
        {
          neuronUUID: fullUUID,
          totalError: 0.1,
          impact: 1e-13,
          reason: "low-impact",
        },
      ],
      candidateSquashes: undefined,
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(discoveryResult, () => 0.5, baseNeuronCount),
    });

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    // The description in evaluations should use short ID
    const removalEval = result.evaluations?.find(
      (e) => e.changeType === "remove-low-impact" && e.kind === "candidate",
    );

    assert(removalEval, "Should have a remove-low-impact evaluation");
    assert(
      removalEval.description?.includes(expectedShortID),
      `Description should use shortID '${expectedShortID}', got: ${removalEval.description}`,
    );
    assertEquals(
      removalEval.description?.includes(fullUUID),
      false,
      `Description should NOT contain full UUID '${fullUUID}', got: ${removalEval.description}`,
    );
  },
);

Deno.test(
  "Discovery improvement message does not duplicate change type after descriptive text",
  async () => {
    const fullUUID = "abc12345-def6-7890-ghij-klmnopqrstuv";
    const baseCreature = makeCreatureWithRemovableNeuron(fullUUID);
    const baseNeuronCount = baseCreature.exportJSON().neurons.length;

    const discoveryResult: DiscoverResult = {
      ID: "NO-DUPLICATE-TEST",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: [
        {
          neuronUUID: fullUUID,
          totalError: 0.1,
          impact: 1e-14,
          reason: "low-impact",
        },
      ],
      candidateSquashes: undefined,
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(discoveryResult, () => 0.5, baseNeuronCount),
    });

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    if (result.improvement?.message) {
      // Message should NOT contain "(remove-low-impact)" since the description
      // already says "Removed low-impact neuron"
      assertEquals(
        result.improvement.message.includes("(remove-low-impact)"),
        false,
        `Message should NOT contain redundant '(remove-low-impact)', got: ${result.improvement.message}`,
      );
    }
  },
);

Deno.test(
  "Discovery improvement message does not include creature short ID at end",
  async () => {
    const fullUUID = "test1234-5678-90ab-cdef-ghijklmnopqr";
    const baseCreature = makeCreatureWithRemovableNeuron(fullUUID);
    const baseNeuronCount = baseCreature.exportJSON().neurons.length;

    const discoveryResult: DiscoverResult = {
      ID: "NO-CREATURE-ID-TEST",
      addHelpfulSynapses: undefined,
      addHelpfulNeurons: undefined,
      removeHarmfulSynapse: undefined,
      removeHarmfulNeurons: undefined,
      removalCandidates: [
        {
          neuronUUID: fullUUID,
          totalError: 0.1,
          impact: 1e-14,
          reason: "low-impact",
        },
      ],
      candidateSquashes: undefined,
    };

    const runner = new DiscoveryRunner({
      rustDiscoveryEnabled: () => true,
      workerFactory: () =>
        new FakeWorker(discoveryResult, () => 0.5, baseNeuronCount),
    });

    const result = await runner.discoverDir({
      creature: baseCreature,
      dataDir: "/tmp/data",
      options: makeOptions(),
    });

    if (result.improvement?.message) {
      // Message should NOT end with a parenthesised creature short ID
      // The pattern (xxxxxxxx) at the end indicates the old format
      const endsWithShortID = /\([a-f0-9]{8}\)$/.test(
        result.improvement.message,
      );
      assertEquals(
        endsWithShortID,
        false,
        `Message should NOT end with creature short ID, got: ${result.improvement.message}`,
      );
    }
  },
);

Deno.test("shortID function returns last 8 chars of UUID", () => {
  const fullUUID = "3e979317-989f-4c5c-8272-02fd85be94a8";
  const result = shortID(fullUUID);
  assertEquals(result, "85be94a8", "shortID should return last 8 characters");
});

Deno.test("shortID function returns full ID if too short", () => {
  const shortStr = "abc123";
  const result = shortID(shortStr);
  assertEquals(result, shortStr, "shortID should return full ID if short");
});

Deno.test("shortID function returns full ID if no dashes", () => {
  const noDashes = "abcdefghijklmnopqrstuvwxyz";
  const result = shortID(noDashes);
  assertEquals(
    result,
    noDashes,
    "shortID should return full ID if no dashes (not a UUID)",
  );
});

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  buildCacheKey,
  extractTargetNeuronInfo,
  recordFailure,
} from "../../src/discovery/FailureCache.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import {
  closeRustLibrary,
  getDiscoveryVersion,
  shouldSkipRustDiscoveryTests,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type { RemovalCandidate } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { makeSimpleCreature } from "../fixtures/SimpleCreatures.ts";

function makeCandidate(
  changeType: string,
  description: string,
  creature?: Creature,
): DiscoveryCandidate {
  return {
    creature: creature ?? makeSimpleCreature(),
    change: {
      type: changeType as DiscoveryCandidate["change"]["type"],
      description,
    },
  };
}

Deno.test({
  name:
    "recordFailure computes actualErrorReduction when originalError is provided",
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      const creature = makeSimpleCreature();
      const candidate: DiscoveryCandidate = {
        creature,
        change: {
          type: "add-neurons",
          description: "Add neuron test",
          expectedErrorReduction: 0.05, // Expected 5% reduction
          neuronDetails: {
            fromNeuronUuid: "input-0",
            toNeuronUuid: "output-0",
            incomingWeight: 0.5,
            outgoingWeight: -0.3,
            bias: 0.1,
            squash: "TANH",
          },
        },
      };

      // Record failure with originalError provided
      // originalError = 0.6, candidateError = 0.58
      // actualErrorReduction = 0.6 - 0.58 = 0.02 (positive means improvement)
      await recordFailure(tempDir, candidate, {
        originalScore: 0.5,
        candidateScore: 0.48,
        scoreDelta: -0.02,
        error: 0.58,
        originalError: 0.6,
      });

      // Read the cache file to verify actualErrorReduction was stored
      const key = buildCacheKey(candidate);
      const filePath = `${tempDir}/add-neurons/${key}.json`;
      const content = await Deno.readTextFile(filePath);
      const parsed = JSON.parse(content);

      // Verify both expected and actual error reduction are present
      assertEquals(
        parsed.expectedErrorReduction,
        0.05,
        "Expected error reduction should be stored",
      );
      assertAlmostEquals(
        parsed.actualErrorReduction,
        0.02,
        1e-9,
        "Actual error reduction should be computed and stored (0.6 - 0.58 = 0.02)",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
      closeRustLibrary();
    }
  },
});

Deno.test("recordFailure omits actualErrorReduction when originalError is not provided", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "add-synapses",
        description: "Add synapse test",
        expectedErrorReduction: 0.03,
      },
    };

    // Record failure WITHOUT originalError
    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.48,
      scoreDelta: -0.02,
      error: 0.58,
      // originalError not provided
    });

    // Read the cache file to verify actualErrorReduction was NOT stored
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/add-synapses/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // Verify expected error reduction is present but actual is not
    assertEquals(
      parsed.expectedErrorReduction,
      0.03,
      "Expected error reduction should be stored",
    );
    assertEquals(
      parsed.actualErrorReduction,
      undefined,
      "Actual error reduction should NOT be stored when originalError is missing",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("recordFailure handles negative actualErrorReduction (error increased)", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "add-neurons",
        description: "Add neuron that made things worse",
        expectedErrorReduction: 0.02, // Expected 2% reduction
      },
    };

    // Record failure where error actually increased
    // originalError = 0.5, candidateError = 0.55
    // actualErrorReduction = 0.5 - 0.55 = -0.05 (negative means error increased)
    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.45,
      scoreDelta: -0.05,
      error: 0.55,
      originalError: 0.5,
    });

    // Read the cache file to verify actualErrorReduction captures the negative value
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/add-neurons/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    assertAlmostEquals(
      parsed.actualErrorReduction,
      -0.05,
      1e-9,
      "Actual error reduction should be negative when error increased",
    );
    assertEquals(
      parsed.expectedErrorReduction,
      0.02,
      "Expected error reduction should still be the predicted value",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("recordFailure omits actualErrorReduction when candidateError is Infinity", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();
    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "add-neurons",
        description: "Add neuron that caused evaluation failure",
        expectedErrorReduction: 0.02,
      },
    };

    // Record failure where candidate error is Infinity (worker evaluation failed)
    // This happens when workers return Number.POSITIVE_INFINITY on failure
    // Without proper validation, this would store -Infinity in the cache
    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: -1, // Score is also bad when error is Infinity
      scoreDelta: -1.5,
      error: Number.POSITIVE_INFINITY, // Worker evaluation failure
      originalError: 0.5, // Original was finite
    });

    // Read the cache file to verify actualErrorReduction was NOT stored
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/add-neurons/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // actualErrorReduction should NOT be stored (it would be -Infinity otherwise)
    assertEquals(
      parsed.actualErrorReduction,
      undefined,
      "actualErrorReduction should NOT be stored when candidateError is Infinity",
    );
    // But error and originalError should still be recorded in metadata
    assertEquals(
      parsed.error,
      null, // JSON serialises Infinity as null
      "error should be recorded (as null in JSON for Infinity)",
    );
    assertEquals(
      parsed.originalError,
      0.5,
      "originalError should be recorded",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("extractTargetNeuronInfo finds neuron using UUID wire fields for add-synapses", () => {
  // Post-migration: extractTargetNeuronInfo extracts the integer neuron ID from
  // the description using regex /-> (\d+)/ and looks up the neuron by that integer ID.
  // deterministicIdFromUuid("3e979317-989f-4c5c-8272-02fd85be94a8") = 1434298466

  const fullTargetUUID = "3e979317-989f-4c5c-8272-02fd85be94a8";
  // Expected integer ID for the target neuron
  const TARGET_ID = 1434298466;

  // Create creature with UUID (will get integer ID via deterministicIdFromUuid)
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: fullTargetUUID, squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: fullTargetUUID, weight: 0.5 },
      { fromUUID: fullTargetUUID, toUUID: "output-0", weight: 0.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);

  // Create add-synapses candidate with integer IDs in description (post-migration format)
  const candidate: DiscoveryCandidate = {
    creature,
    change: {
      type: "add-synapses",
      description: `🔗 Added helpful synapse 0 -> ${TARGET_ID}`,
      synapseCandidate: {
        fromNeuronUuid: "input-0",
        toNeuronUuid: fullTargetUUID,
        weight: 0.25,
        targetNeuronImpact: 1,
        expectedCreatureErrorReduction: 0.01,
        expectedCreatureScoreGain: 0.01,
        improvedCount: 1,
        totalCount: 1,
      },
    },
  };

  // Extract target neuron info via UUID wire fields
  const result = extractTargetNeuronInfo(candidate, creature);

  assert(result !== undefined, "Should find target neuron using UUID");
  assertEquals(
    result!.uuid,
    fullTargetUUID,
    "Should return correct target neuron UUID",
  );
  assertEquals(result!.squash, "TANH", "Should return correct squash function");
});

Deno.test({
  name: "getDiscoveryVersion returns version string when library is available",
  ignore: shouldSkipRustDiscoveryTests(),
  fn: () => {
    try {
      const version = getDiscoveryVersion();

      // Version should be a non-empty string in semver format (e.g., "0.1.151")
      assert(
        typeof version === "string",
        "Version should be a string when library is available",
      );
      assert(version!.length > 0, "Version string should not be empty");

      // Check it looks like a semver version (x.y.z format)
      const semverPattern = /^\d+\.\d+\.\d+$/;
      assert(
        semverPattern.test(version!),
        `Version should be in semver format (x.y.z), got: ${version}`,
      );

      // Verify caching - second call should return same value
      const version2 = getDiscoveryVersion();
      assertEquals(
        version,
        version2,
        "Version should be cached and return same value on subsequent calls",
      );
    } finally {
      closeRustLibrary();
    }
  },
});

Deno.test({
  name: "recordFailure includes discoveryVersion in cache entry",
  ignore: shouldSkipRustDiscoveryTests(),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      const creature = makeSimpleCreature();
      const candidate = makeCandidate("add-synapses", "test synapse", creature);

      // Record the failure
      await recordFailure(tempDir, candidate, {
        originalScore: 0.5,
        candidateScore: 0.4,
        scoreDelta: -0.1,
        error: 0.6,
      });

      // Read the cache file to verify discoveryVersion was stored
      const key = buildCacheKey(candidate);
      const filePath = `${tempDir}/add-synapses/${key}.json`;
      const content = await Deno.readTextFile(filePath);
      const parsed = JSON.parse(content);

      // Verify discoveryVersion is present and matches the library version
      const expectedVersion = getDiscoveryVersion();
      assert(
        parsed.discoveryVersion !== undefined,
        "discoveryVersion should be stored in cache entry",
      );
      assertEquals(
        parsed.discoveryVersion,
        expectedVersion,
        "discoveryVersion should match library version",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
      closeRustLibrary();
    }
  },
});

Deno.test("recordFailure includes removalCandidate in rustRequest for remove-low-impact", async () => {
  // Issue #922: Failure cache should include the Rust removal candidate in full
  // for debugging purposes when a remove-low-impact candidate fails to improve score
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();

    // Create a RemovalCandidate as Rust would return it
    const removalCandidate: RemovalCandidate = {
      neuronUuid: "hidden-1",
      totalError: 5.0,
      impact: 0.00861,
      reason:
        "High error (5.0000) but very low impact (0.008610) - far from outputs",
    };

    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "remove-low-impact",
        description: `🪶 Removed neuron hidden-1 (impact: ${
          removalCandidate.impact.toExponential(2)
        })`,
        removalCandidate, // This is the new field added for issue #922
      },
    };

    // Record the failure with metadata similar to what DiscoveryRunner provides
    await recordFailure(tempDir, candidate, {
      originalScore: 0.41707403281995525,
      candidateScore: 0.4170737892294639,
      scoreDelta: -2.435904913333786e-7,
      error: 0.5827146017775101,
      originalError: 0.58271423818702,
    }, creature); // Pass base creature for actual changes extraction

    // Read the cache file to verify rustRequest.removalCandidate was stored
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/remove-low-impact/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // Verify rustRequest contains the removalCandidate
    assert(
      parsed.rustRequest !== undefined,
      "rustRequest should be present in cache entry",
    );
    assert(
      parsed.rustRequest.removalCandidate !== undefined,
      "rustRequest.removalCandidate should be present",
    );
    assertEquals(
      parsed.rustRequest.removalCandidate.neuronUuid,
      "hidden-1",
      "removalCandidate.neuronUuid should match",
    );
    assertEquals(
      parsed.rustRequest.removalCandidate.neuronId,
      undefined,
      "removalCandidate.neuronId must not be persisted",
    );
    assertEquals(
      parsed.rustRequest.removalCandidate.totalError,
      5.0,
      "removalCandidate.totalError should match",
    );
    assertEquals(
      parsed.rustRequest.removalCandidate.impact,
      0.00861,
      "removalCandidate.impact should match",
    );
    assertEquals(
      parsed.rustRequest.removalCandidate.reason,
      "High error (5.0000) but very low impact (0.008610) - far from outputs",
      "removalCandidate.reason should match",
    );
    assertEquals(content.includes('"neuronId"'), false);
    assertEquals(content.includes('"fromNeuronId"'), false);
    assertEquals(content.includes('"toNeuronId"'), false);

    // Also verify other standard fields are present
    assertEquals(parsed.changeType, "remove-low-impact");
    assert(parsed.timestamp !== undefined, "timestamp should be present");
    assert(
      parsed.actualErrorReduction !== undefined,
      "actualErrorReduction should be computed",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("recordFailure includes harmfulNeuronCandidate in rustRequest for remove-neuron", async () => {
  // Issue #922: Failure cache should include the harmful neuron candidate in full
  // for debugging purposes when a remove-neuron candidate fails to improve score
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();

    // Create a CandidateHarmfulNeuron as would be produced during analysis
    const harmfulNeuronCandidate: CandidateHarmfulNeuron = {
      neuronUuid: "hidden-1",
      errorMagnitude: 1.5e11,
      expectedCreatureScoreGain: 0.05,
      sampleCount: 100,
      averageActivation: 0.75,
    };

    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "remove-neuron",
        description: `💀 Removed harmful neuron hidden-1 (error: ${
          harmfulNeuronCandidate.errorMagnitude.toExponential(2)
        })`,
        expectedErrorReduction:
          harmfulNeuronCandidate.expectedCreatureScoreGain,
        sampleSize: harmfulNeuronCandidate.sampleCount,
        harmfulNeuronCandidate,
      },
    };

    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.48,
      scoreDelta: -0.02,
      error: 0.55,
      originalError: 0.52,
    }, creature);

    // Read and verify the cache file
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/remove-neuron/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // Verify rustRequest contains the harmfulNeuronCandidate
    assert(
      parsed.rustRequest !== undefined,
      "rustRequest should be present in cache entry",
    );
    assert(
      parsed.rustRequest.harmfulNeuronCandidate !== undefined,
      "rustRequest.harmfulNeuronCandidate should be present",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.neuronUuid,
      "hidden-1",
      "harmfulNeuronCandidate.neuronUuid should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.neuronId,
      undefined,
      "harmfulNeuronCandidate.neuronId must not be persisted",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.errorMagnitude,
      1.5e11,
      "harmfulNeuronCandidate.errorMagnitude should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.expectedCreatureScoreGain,
      0.05,
      "harmfulNeuronCandidate.expectedCreatureScoreGain should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.sampleCount,
      100,
      "harmfulNeuronCandidate.sampleCount should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulNeuronCandidate.averageActivation,
      0.75,
      "harmfulNeuronCandidate.averageActivation should match",
    );

    assertEquals(parsed.changeType, "remove-neuron");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

Deno.test("recordFailure includes harmfulSynapseCandidate in rustRequest for remove-synapse", async () => {
  // Issue #922: Failure cache should include the harmful synapse candidate in full
  // for debugging purposes when a remove-synapse candidate fails to improve score
  const tempDir = await Deno.makeTempDir();

  try {
    const creature = makeSimpleCreature();

    // Create a CandidateSynapse as would be produced during harmful synapse analysis
    const harmfulSynapseCandidate: CandidateSynapse = {
      fromNeuronUuid: "input-0",
      toNeuronUuid: "hidden-1",
      weight: -0.5,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0,
      expectedCreatureScoreGain: 0.03,
      improvedCount: 80,
      totalCount: 100,
    };

    const candidate: DiscoveryCandidate = {
      creature,
      change: {
        type: "remove-synapse",
        description: `✂️ Removed harmful synapse input-0 -> hidden-1`,
        expectedErrorReduction:
          harmfulSynapseCandidate.expectedCreatureScoreGain,
        sampleSize: harmfulSynapseCandidate.totalCount,
        synapseDetails: {
          fromNeuronUuid: harmfulSynapseCandidate.fromNeuronUuid,
          toNeuronUuid: harmfulSynapseCandidate.toNeuronUuid,
        },
        harmfulSynapseCandidate,
      },
    };

    await recordFailure(tempDir, candidate, {
      originalScore: 0.5,
      candidateScore: 0.49,
      scoreDelta: -0.01,
      error: 0.53,
      originalError: 0.51,
    }, creature);

    // Read and verify the cache file
    const key = buildCacheKey(candidate);
    const filePath = `${tempDir}/remove-synapse/${key}.json`;
    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content);

    // Verify rustRequest contains the harmfulSynapseCandidate
    assert(
      parsed.rustRequest !== undefined,
      "rustRequest should be present in cache entry",
    );
    assert(
      parsed.rustRequest.harmfulSynapseCandidate !== undefined,
      "rustRequest.harmfulSynapseCandidate should be present",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.fromNeuronUuid,
      "input-0",
      "harmfulSynapseCandidate.fromNeuronUuid should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.toNeuronUuid,
      "hidden-1",
      "harmfulSynapseCandidate.toNeuronUuid should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.fromNeuronId,
      undefined,
      "harmfulSynapseCandidate.fromNeuronId must not be persisted",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.toNeuronId,
      undefined,
      "harmfulSynapseCandidate.toNeuronId must not be persisted",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.weight,
      -0.5,
      "harmfulSynapseCandidate.weight should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.expectedCreatureScoreGain,
      0.03,
      "harmfulSynapseCandidate.expectedCreatureScoreGain should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.improvedCount,
      80,
      "harmfulSynapseCandidate.improvedCount should match",
    );
    assertEquals(
      parsed.rustRequest.harmfulSynapseCandidate.totalCount,
      100,
      "harmfulSynapseCandidate.totalCount should match",
    );

    assertEquals(parsed.changeType, "remove-synapse");
    // Also verify synapseDetails is still present (for cache key)
    assert(
      parsed.synapseDetails !== undefined,
      "synapseDetails should still be present",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    closeRustLibrary();
  }
});

import { assertEquals } from "@std/assert";
import { join } from "@std/path/join";
import { Creature } from "../../src/Creature.ts";
import {
  deleteSuccessByKeySync,
  listSuccessEntriesSync,
  recordSuccessSync,
} from "../../src/discovery/SuccessCache.ts";
import type { DiscoveryCandidate } from "../../src/discovery/DiscoveryCandidates.ts";
import { closeRustLibrary } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

Deno.test("SuccessCache: listSuccessEntriesSync returns [] for missing directory and skips corrupt JSON", async () => {
  const missing = join(await Deno.makeTempDir(), "does-not-exist");
  assertEquals(listSuccessEntriesSync(missing), []);

  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-success-cache-bad-",
  });
  try {
    const typeDir = join(cacheDir, "add-synapses");
    await Deno.mkdir(typeDir, { recursive: true });
    await Deno.writeTextFile(join(typeDir, "bad.json"), "{not-json");
    assertEquals(listSuccessEntriesSync(cacheDir), []);
  } finally {
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
});

Deno.test("SuccessCache: deleteSuccessByKeySync ignores missing files", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-success-cache-del-",
  });
  try {
    deleteSuccessByKeySync(cacheDir, "add-synapses", "missing-key");
  } finally {
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
});

Deno.test("SuccessCache: recordSuccessSync captures rustRequest fields for many candidate shapes", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "neat-ai-success-cache-rust-",
  });
  try {
    const baseCreature = Creature.fromJSON({
      input: 1,
      output: 1,
      neurons: [{
        uuid: "output-0",
        type: "output",
        squash: "IDENTITY",
        bias: 0,
      }],
      synapses: [],
    });

    const candidate: DiscoveryCandidate = {
      creature: baseCreature,
      change: {
        type: "add-neurons",
        description: "all-fields",
        neuronDetails: {
          fromNeuronId: 0,
          toNeuronId: -1,
          incomingWeight: 0.1,
          outgoingWeight: 0.2,
          bias: 0.01,
          squash: "IDENTITY",
        },
        neuronCandidate: {
          fromNeuronId: 0,
          toNeuronId: -1,
          incomingWeight: 0.1,
          outgoingWeight: 0.2,
          bias: 0.01,
          squash: "IDENTITY",
          targetNeuronImpact: 1,
          expectedCreatureErrorReduction: 0.01,
          expectedCreatureScoreGain: 0.01,
          improvedCount: 1,
          totalCount: 1,
        },
        coordinatedStructuralCandidate: {
          type: "coordinated_structural",
          expectedCreatureScoreGain: 0.01,
          operations: [
            { type: "removeSynapse", fromNeuronId: 6000, toNeuronId: 6001 },
            {
              type: "addSynapse",
              fromNeuronId: 6000,
              toNeuronId: 6001,
              weight: 0.2,
            },
          ],
        },
        synapseCandidate: {
          fromNeuronId: 0,
          toNeuronId: -1,
          weight: 0.5,
          targetNeuronImpact: 1,
          expectedCreatureErrorReduction: 0.01,
          expectedCreatureScoreGain: 0.01,
          improvedCount: 1,
          totalCount: 1,
        },
        squashCandidate: {
          neuronId: -1,
          previousSquash: "IDENTITY",
          squash: "TANH",
          expectedCreatureScoreGain: 0.01,
          improvedError: 0.9,
          currentError: 1.0,
        },
        removalCandidate: {
          neuronId: 7000,
          totalError: 1,
          impact: 0.0001,
          reason: "test",
        },
        harmfulNeuronCandidate: {
          neuronId: 7001,
          errorMagnitude: 1,
          expectedCreatureScoreGain: 0.01,
          sampleCount: 1,
          averageActivation: 0,
        },
        harmfulSynapseCandidate: {
          fromNeuronId: 6002,
          toNeuronId: 6003,
          weight: 0.1,
          targetNeuronImpact: 1,
          expectedCreatureErrorReduction: 0.01,
          expectedCreatureScoreGain: 0.01,
          improvedCount: 1,
          totalCount: 1,
        },
        synapseDetails: { fromNeuronId: 6002, toNeuronId: 6003 },
      },
    };

    recordSuccessSync(
      cacheDir,
      candidate,
      {
        originalScore: 1,
        candidateScore: 2,
        scoreDelta: 1,
        originalError: 1,
        error: 0.5,
      },
      baseCreature,
    );

    const entries = listSuccessEntriesSync(cacheDir);
    assertEquals(entries.length, 1);
    const rr = entries[0].rustRequest as Record<string, unknown>;
    assertEquals(typeof rr.neuronDetails, "object");
    assertEquals(typeof rr.neuronCandidate, "object");
    assertEquals(typeof rr.coordinatedStructuralCandidate, "object");
    assertEquals(typeof rr.synapseCandidate, "object");
    assertEquals(typeof rr.squashCandidate, "object");
    assertEquals(typeof rr.removalCandidate, "object");
    assertEquals(typeof rr.harmfulNeuronCandidate, "object");
    assertEquals(typeof rr.harmfulSynapseCandidate, "object");
    assertEquals(typeof rr.synapseDetails, "object");
  } finally {
    closeRustLibrary();
    try {
      await Deno.remove(cacheDir, { recursive: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
});

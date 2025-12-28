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
          fromNeuronUUID: "input-0",
          toNeuronUUID: "output-0",
          incomingWeight: 0.1,
          outgoingWeight: 0.2,
          bias: 0.01,
          squash: "IDENTITY",
        },
        neuronCandidate: {
          fromNeuronUUID: "input-0",
          toNeuronUUID: "output-0",
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
        splitSynapseInsertNeuronCandidate: {
          type: "split_synapse_insert_neuron",
          fromNeuronUuid: "a",
          toNeuronUuid: "b",
          oldWeight: 0.1,
          newNeuron: { uuid: "c", type: "hidden", squash: "IDENTITY", bias: 0 },
          newSynapses: [
            { from_uuid: "a", to_uuid: "c", weight: 0.2 },
            { from_uuid: "c", to_uuid: "b", weight: 0.3 },
          ],
          expectedCreatureScoreGain: 0.01,
        },
        synapseCandidate: {
          fromNeuronUUID: "input-0",
          toNeuronUUID: "output-0",
          weight: 0.5,
          targetNeuronImpact: 1,
          expectedCreatureErrorReduction: 0.01,
          expectedCreatureScoreGain: 0.01,
          improvedCount: 1,
          totalCount: 1,
        },
        squashCandidate: {
          neuronUUID: "output-0",
          previousSquash: "IDENTITY",
          squash: "TANH",
          expectedCreatureScoreGain: 0.01,
          improvedError: 0.9,
          currentError: 1.0,
        },
        removalCandidate: {
          neuronUUID: "x",
          totalError: 1,
          impact: 0.0001,
          reason: "test",
        },
        harmfulNeuronCandidate: {
          neuronUUID: "y",
          errorMagnitude: 1,
          expectedCreatureScoreGain: 0.01,
          sampleCount: 1,
          averageActivation: 0,
        },
        harmfulSynapseCandidate: {
          fromNeuronUUID: "m",
          toNeuronUUID: "n",
          weight: 0.1,
          targetNeuronImpact: 1,
          expectedCreatureErrorReduction: 0.01,
          expectedCreatureScoreGain: 0.01,
          improvedCount: 1,
          totalCount: 1,
        },
        synapseDetails: { fromNeuronUUID: "m", toNeuronUUID: "n" },
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
    assertEquals(typeof rr.splitSynapseInsertNeuronCandidate, "object");
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

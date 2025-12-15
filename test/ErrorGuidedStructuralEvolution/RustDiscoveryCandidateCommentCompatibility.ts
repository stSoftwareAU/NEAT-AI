import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  RustCandidateNeuron,
  RustCandidateSynapse,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

type DiscoverStructurePrivateApi = {
  mapRustNeuronCandidate: (
    candidate: RustCandidateNeuron,
  ) => { comment?: string };
  mapRustCandidate: (candidate: RustCandidateSynapse) => { comment?: string };
};

function makeCreatureWithUuid(): Creature {
  const creature = Creature.fromJSON({
    input: 1,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [{ fromUUID: "input-0", toUUID: "output-0", weight: 1 }],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test(
  "Rust discovery candidate parsing succeeds with optional comment field",
  () => {
    const baseDirectory = Deno.makeTempDirSync({ prefix: "neat-ai-comment-" });
    try {
      const discoverStructure = new DiscoverStructure(
        makeCreatureWithUuid(),
        1,
        1,
        {},
        { baseDirectory, skipRecordPhase: true },
      );

      const neuronJson = JSON.stringify({
        sourceNeuronUuid: "input-0",
        targetNeuronUuid: "output-0",
        incomingWeight: 0.42,
        outgoingWeight: -0.13,
        squash: "TANH",
        bias: 0.01,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.0,
        expectedCreatureScoreGain: 0.123,
        improvedCount: 4,
        totalCount: 5,
        comment: "diagnostic: add-neuron suggested due to error spike cluster",
      });

      const parsedNeuron = JSON.parse(neuronJson) as RustCandidateNeuron;
      const mappedNeuron =
        (discoverStructure as unknown as DiscoverStructurePrivateApi)
          .mapRustNeuronCandidate(parsedNeuron);
      assertEquals(
        mappedNeuron.comment,
        "diagnostic: add-neuron suggested due to error spike cluster",
      );

      const synapseJson = JSON.stringify({
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
        weight: 0.99,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.0,
        expectedCreatureScoreGain: 0.5,
        improvedCount: 8,
        totalCount: 10,
        comment: "diagnostic: add-synapse chosen as strongest source",
      });

      const parsedSynapse = JSON.parse(synapseJson) as RustCandidateSynapse;
      const mappedSynapse =
        (discoverStructure as unknown as DiscoverStructurePrivateApi)
          .mapRustCandidate(parsedSynapse);
      assertEquals(
        mappedSynapse.comment,
        "diagnostic: add-synapse chosen as strongest source",
      );
    } finally {
      Deno.removeSync(baseDirectory, { recursive: true });
    }
  },
);

Deno.test(
  "Rust discovery candidate parsing succeeds when comment is absent",
  () => {
    const baseDirectory = Deno.makeTempDirSync({ prefix: "neat-ai-comment-" });
    try {
      const discoverStructure = new DiscoverStructure(
        makeCreatureWithUuid(),
        1,
        1,
        {},
        { baseDirectory, skipRecordPhase: true },
      );

      const neuronJson = JSON.stringify({
        sourceNeuronUuid: "input-0",
        targetNeuronUuid: "output-0",
        incomingWeight: 0.42,
        outgoingWeight: -0.13,
        squash: "TANH",
        bias: 0.01,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.0,
        expectedCreatureScoreGain: 0.123,
        improvedCount: 4,
        totalCount: 5,
      });

      const parsedNeuron = JSON.parse(neuronJson) as RustCandidateNeuron;
      const mappedNeuron =
        (discoverStructure as unknown as DiscoverStructurePrivateApi)
          .mapRustNeuronCandidate(parsedNeuron);
      assertEquals(mappedNeuron.comment, undefined);

      const synapseJson = JSON.stringify({
        fromNeuronUuid: "input-0",
        toNeuronUuid: "output-0",
        weight: 0.99,
        targetNeuronImpact: 1.0,
        expectedCreatureErrorReduction: 0.0,
        expectedCreatureScoreGain: 0.5,
        improvedCount: 8,
        totalCount: 10,
      });

      const parsedSynapse = JSON.parse(synapseJson) as RustCandidateSynapse;
      const mappedSynapse =
        (discoverStructure as unknown as DiscoverStructurePrivateApi)
          .mapRustCandidate(parsedSynapse);
      assertEquals(mappedSynapse.comment, undefined);
    } finally {
      Deno.removeSync(baseDirectory, { recursive: true });
    }
  },
);

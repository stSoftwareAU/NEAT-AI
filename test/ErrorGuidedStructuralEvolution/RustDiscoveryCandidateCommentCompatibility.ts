import { assertEquals } from "@std/assert";
import {
  mapRustCandidate,
  mapRustNeuronCandidate,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverAnalysis.ts";
import type {
  RustCandidateNeuron,
  RustCandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

// Issue #2849: These tests previously reached the private
// `DiscoverStructure.mapRustNeuronCandidate` / `mapRustCandidate` methods
// through an `as unknown as` cast, coupling them to the class's internal
// factoring. The mapping logic is exposed as documented public functions in
// DiscoverAnalysis.ts, so we exercise that stable surface directly. The
// observable WHAT — a Rust candidate's optional `comment` survives the mapping
// into the TypeScript candidate shape — is unchanged.

Deno.test(
  "Rust discovery candidate mapping preserves the optional comment field",
  () => {
    const parsedNeuron = JSON.parse(JSON.stringify({
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
    })) as RustCandidateNeuron;

    const mappedNeuron = mapRustNeuronCandidate(parsedNeuron);
    assertEquals(
      mappedNeuron.comment,
      "diagnostic: add-neuron suggested due to error spike cluster",
    );
    assertEquals(mappedNeuron.fromNeuronUuid, "input-0");
    assertEquals(mappedNeuron.toNeuronUuid, "output-0");

    const parsedSynapse = JSON.parse(JSON.stringify({
      fromNeuronUuid: "input-0",
      toNeuronUuid: "output-0",
      weight: 0.99,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.0,
      expectedCreatureScoreGain: 0.5,
      improvedCount: 8,
      totalCount: 10,
      comment: "diagnostic: add-synapse chosen as strongest source",
    })) as RustCandidateSynapse;

    const mappedSynapse = mapRustCandidate(parsedSynapse);
    assertEquals(
      mappedSynapse.comment,
      "diagnostic: add-synapse chosen as strongest source",
    );
    assertEquals(mappedSynapse.fromNeuronUuid, "input-0");
    assertEquals(mappedSynapse.toNeuronUuid, "output-0");
  },
);

Deno.test(
  "Rust discovery candidate mapping leaves comment undefined when absent",
  () => {
    const parsedNeuron = JSON.parse(JSON.stringify({
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
    })) as RustCandidateNeuron;

    const mappedNeuron = mapRustNeuronCandidate(parsedNeuron);
    assertEquals(mappedNeuron.comment, undefined);
    assertEquals(mappedNeuron.fromNeuronUuid, "input-0");
    assertEquals(mappedNeuron.toNeuronUuid, "output-0");

    const parsedSynapse = JSON.parse(JSON.stringify({
      fromNeuronUuid: "input-0",
      toNeuronUuid: "output-0",
      weight: 0.99,
      targetNeuronImpact: 1.0,
      expectedCreatureErrorReduction: 0.0,
      expectedCreatureScoreGain: 0.5,
      improvedCount: 8,
      totalCount: 10,
    })) as RustCandidateSynapse;

    const mappedSynapse = mapRustCandidate(parsedSynapse);
    assertEquals(mappedSynapse.comment, undefined);
    assertEquals(mappedSynapse.fromNeuronUuid, "input-0");
    assertEquals(mappedSynapse.toNeuronUuid, "output-0");
  },
);

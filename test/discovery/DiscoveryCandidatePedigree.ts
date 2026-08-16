/**
 * Issue #3751 — Discovery-derived candidates must inherit their parent's pedigree.
 *
 * The NEAT-AI-Discovery Rust extension is candidate-*generating* but never
 * writes creature JSON: it returns candidate descriptors over FFI and the
 * derived creature is built here, in TypeScript, from the parent creature
 * (`src/discovery/CandidateCreation.ts`). That makes this the durable detection
 * point for the parent issue's failure mode — a derived candidate silently
 * losing the parent's per-neuron or per-synapse tags.
 *
 * `memetic` is different: `memeticUpdate` (`src/blackbox/MemeticUpdate.ts`)
 * returns `undefined` whenever the child's topology diverges from the parent's,
 * so a topology-changing candidate resets the fine-tuning record by design. The
 * final test pins that contract so a change of intent is visible, rather than
 * being mistaken for the silent strip this milestone is fixing.
 *
 * Per-extension verdicts: `docs/RUST_EXTENSION_WRITE_PATH_AUDIT.md`.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import type { TagInterface } from "@stsoftware/tags/mod";
import type {
  CandidateSquash,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import {
  buildSingleSquashCandidates,
  buildSingleSynapseCandidates,
} from "@discovery/CandidateCreation.ts";

/** Explicit runtime id so the memetic fixture can key its bias entry. */
const HIDDEN_ID = 5000;

const PEDIGREE_TAG = {
  name: "intelligentDesign",
  value: "Swish -> SOFTSIGN",
};

/**
 * Parent creature carrying the metadata surfaces the Rust rewrite path drops:
 * top-level tags, per-neuron tags, per-synapse tags and a `memetic` block.
 *
 * Topology: input-0 -> hidden-0 -> output-0, plus a direct input-1 -> output-0
 * edge so the output stays reachable regardless of the candidate applied.
 */
function makeParentCreature(): Creature {
  return Creature.fromJSON({
    input: 2,
    output: 1,
    tags: [{ name: "name", value: "pedigree-parent" }],
    neurons: [
      {
        uuid: "hidden-0",
        id: HIDDEN_ID,
        type: "hidden",
        squash: IDENTITY.NAME,
        bias: 0.1,
        tags: [PEDIGREE_TAG],
      },
      {
        uuid: "output-0",
        type: "output",
        squash: IDENTITY.NAME,
        bias: 0,
        tags: [{ name: "role", value: "output" }],
      },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "hidden-0",
        weight: 0.2,
        tags: [{ name: "origin", value: "pedigree" }],
      },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.05 },
    ],
    memetic: {
      generation: 1,
      score: 0,
      weights: {},
      biases: { [HIDDEN_ID]: 0.1 },
    },
  });
}

/** Assert `tags` carries `expected`; extra stamped tags are allowed. */
function assertCarriesTag(
  tags: TagInterface[] | undefined,
  expected: TagInterface,
  context: string,
) {
  assert(tags, `${context}: no tags at all`);
  assert(
    tags.some((t) => t.name === expected.name && t.value === expected.value),
    `${context}: expected tag ${expected.name}="${expected.value}", got ${
      JSON.stringify(tags)
    }`,
  );
}

/** Assert the parent's tag pedigree survived onto a derived candidate. */
function assertTagsInherited(candidate: Creature, context: string) {
  const exported = candidate.exportJSON();
  normaliseCreatureExport(exported);

  assertCarriesTag(
    exported.tags,
    { name: "name", value: "pedigree-parent" },
    `${context}: creature tags`,
  );

  const hidden = exported.neurons.find((n) => n.uuid === "hidden-0");
  assert(hidden, `${context}: hidden-0 missing from the candidate`);
  assertCarriesTag(hidden.tags, PEDIGREE_TAG, `${context}: hidden neuron tags`);

  const output = exported.neurons.find((n) => n.uuid === "output-0");
  assert(output, `${context}: output-0 missing from the candidate`);
  assertCarriesTag(
    output.tags,
    { name: "role", value: "output" },
    `${context}: output neuron tags`,
  );

  const tagged = exported.synapses.find((s) =>
    s.tags?.some((t) => t.name === "origin")
  );
  assert(tagged, `${context}: tagged parent synapse dropped`);
  assertCarriesTag(
    tagged.tags,
    { name: "origin", value: "pedigree" },
    `${context}: synapse tags`,
  );
}

const HELPFUL_SYNAPSE: CandidateSynapse = {
  fromNeuronUuid: "input-0",
  toNeuronUuid: "output-0",
  weight: 0.4,
  targetNeuronImpact: 1,
  expectedCreatureErrorReduction: 0.05,
  expectedCreatureScoreGain: 0.03,
  improvedCount: 5,
  totalCount: 10,
};

Deno.test("Discovery add-synapse candidate inherits the parent's tags", () => {
  const parent = makeParentCreature();

  const candidates = buildSingleSynapseCandidates("issue-3751", parent, [
    HELPFUL_SYNAPSE,
  ]);

  assertEquals(candidates.length, 1, "expected one add-synapse candidate");
  assertTagsInherited(candidates[0].creature, "add-synapse");
});

Deno.test("Discovery change-squash candidate inherits the parent's tags", () => {
  const parent = makeParentCreature();
  const squash: CandidateSquash = {
    neuronUuid: "hidden-0",
    previousSquash: IDENTITY.NAME,
    squash: "SOFTSIGN",
    expectedCreatureScoreGain: 0.02,
    improvedError: 0.01,
    currentError: 0.03,
  };

  const candidates = buildSingleSquashCandidates("issue-3751", parent, [
    squash,
  ]);

  assertEquals(candidates.length, 1, "expected one change-squash candidate");
  assertTagsInherited(candidates[0].creature, "change-squash");
});

Deno.test("Discovery candidate generation leaves the parent creature untouched", () => {
  const parent = makeParentCreature();
  const before = JSON.stringify(parent.exportJSON());

  buildSingleSynapseCandidates("issue-3751", parent, [HELPFUL_SYNAPSE]);

  assertEquals(
    JSON.stringify(parent.exportJSON()),
    before,
    "candidate generation must not mutate the parent creature",
  );
});

Deno.test("Discovery add-synapse candidate resets memetic by contract", () => {
  const parent = makeParentCreature();
  assert(parent.memetic, "fixture must start with a memetic record");

  const candidates = buildSingleSynapseCandidates("issue-3751", parent, [
    HELPFUL_SYNAPSE,
  ]);

  assertEquals(candidates.length, 1, "expected one add-synapse candidate");
  // The child gains a synapse the parent lacks, so `memeticUpdate` returns
  // `undefined` and the caller falls back to re-discovering the fine-tuning
  // record. Fine-tuning state is bound to a topology; tags are not.
  assertEquals(
    candidates[0].creature.exportJSON().memetic,
    undefined,
    "add-synapse must reset memetic rather than carry stale fine-tuning state",
  );
});

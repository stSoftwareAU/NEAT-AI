/**
 * Issue #3975 — replaying a core removal must carry the rewrite core applied
 * to the neurons that *survived* it.
 *
 * `applyChangeToCreature` replays an accepted removal onto a second creature
 * (this is how a combined candidate stacks two singles). It does that by
 * diffing base against candidate. Membership diffing alone was enough while
 * removal was TypeScript deletion, but NEAT-AI-core canonicalises what it
 * leaves behind: a hidden neuron stranded without an inward edge becomes a
 * unity `constant` with its fixed activation folded into the outgoing weight.
 *
 * Those are edits to rows that are present in *both* base and candidate, so a
 * membership diff cannot see them. Missing them leaves the replayed creature
 * holding a hidden neuron with no inward edge, which
 * `validateAndFixCreatureSync` then quietly repairs with `fix()` — the very
 * "bug in modification logic" that path logs about.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { applyChangeToCreature } from "@discovery/CandidateApplication.ts";
import { removeLowImpactNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";
import type { DiscoveryCandidate } from "@discovery/DiscoveryCandidates.ts";

/**
 * `feeder -> stranded -> output-0` plus an independent `input-1 -> other`
 * path, so removing `feeder` leaves `stranded` with no inward edge and the
 * creature still has a live route to the output.
 */
function base(): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "feeder", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "stranded", type: "hidden", squash: IDENTITY.NAME, bias: 0.2 },
      { uuid: "other", type: "hidden", squash: IDENTITY.NAME, bias: 0.3 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "feeder", weight: 0.4 },
      { fromUUID: "feeder", toUUID: "stranded", weight: 0.5 },
      { fromUUID: "stranded", toUUID: "output-0", weight: 0.6 },
      { fromUUID: "input-1", toUUID: "other", weight: 0.7 },
      { fromUUID: "other", toUUID: "output-0", weight: 0.8 },
    ],
  };
  return Creature.fromJSON(json);
}

/** The candidate an accepted `remove-low-impact` of `feeder` produces. */
function candidateOf(baseCreature: Creature): Creature {
  const removed = removeLowImpactNeuron("replay-test", baseCreature, {
    neuronUuid: "feeder",
    totalError: 0.001,
    impact: 0.0001,
    meanActivation: 0.25,
    // deno-lint-ignore no-explicit-any
  } as any);
  assert(removed, "core should accept removing the feeder");
  return removed;
}

function neuronOf(creature: Creature, uuid: string) {
  return creature.exportJSON().neurons.find((n) => n.uuid === uuid);
}

Deno.test("replaying a core removal carries the survivor canonicalisation", () => {
  const original = base();
  const candidateCreature = candidateOf(base());

  // What core did to the survivor is the thing the replay must reproduce.
  const strandedInCandidate = neuronOf(candidateCreature, "stranded");
  assert(strandedInCandidate, "the survivor should still be present");
  assertEquals(
    strandedInCandidate.type,
    "constant",
    "core canonicalises a neuron left with no inward edge to a constant",
  );

  const candidate: DiscoveryCandidate = {
    creature: candidateCreature,
    change: { type: "remove-low-impact" },
  };

  const replayed = applyChangeToCreature(original, candidate, original);
  assert(replayed, "the replay should produce a creature");

  const strandedInReplay = neuronOf(replayed, "stranded");
  assert(strandedInReplay, "the survivor should survive the replay too");
  assertEquals(
    strandedInReplay.type,
    "constant",
    "the replay must carry the survivor's new role, not leave it hidden " +
      "with no inward edge for fix() to repair",
  );
  assertEquals(
    strandedInReplay.bias,
    strandedInCandidate.bias,
    "the replay must carry the survivor's folded bias",
  );
});

Deno.test("replaying a core removal carries the folded outgoing weight", () => {
  const original = base();
  const candidateCreature = candidateOf(base());

  const outgoingIn = (creature: Creature) =>
    creature.exportJSON().synapses.find((s) =>
      s.fromUUID === "stranded" && s.toUUID === "output-0"
    );

  const inCandidate = outgoingIn(candidateCreature);
  assert(inCandidate, "the survivor should still feed the output");

  const candidate: DiscoveryCandidate = {
    creature: candidateCreature,
    change: { type: "remove-low-impact" },
  };
  const replayed = applyChangeToCreature(original, candidate, original);
  assert(replayed, "the replay should produce a creature");

  const inReplay = outgoingIn(replayed);
  assert(inReplay, "the survivor should still feed the output after replay");
  assertAlmostEquals(
    inReplay.weight,
    inCandidate.weight,
    1e-12,
    "the activation core folded into the outgoing weight must be replayed; " +
      "an unreplayed weight silently changes what the creature computes",
  );
});

Deno.test("replaying a core removal needs no fix() to validate", () => {
  const original = base();
  const candidate: DiscoveryCandidate = {
    creature: candidateOf(base()),
    change: { type: "remove-low-impact" },
  };

  const replayed = applyChangeToCreature(original, candidate, original);
  assert(replayed, "the replay should produce a creature");

  // The removed neuron is gone, and nothing was left for fix() to repair:
  // validate() is the same gate validateAndFixCreatureSync applies first.
  assertEquals(
    neuronOf(replayed, "feeder"),
    undefined,
    "the removed neuron must not survive the replay",
  );
  replayed.validate();
});

Deno.test("replaying a removal leaves an unrelated earlier edit alone", () => {
  // The replay target carries a prior edit to a neuron the removal never
  // touched; only rows the removal actually changed may be overwritten.
  const target = base();
  const targetJSON = target.exportJSON();
  const other = targetJSON.neurons.find((n) => n.uuid === "other");
  assert(other, "the unrelated neuron should exist");
  other.bias = 0.9;
  const edited = Creature.fromJSON(targetJSON);

  const candidate: DiscoveryCandidate = {
    creature: candidateOf(base()),
    change: { type: "remove-low-impact" },
  };

  const replayed = applyChangeToCreature(edited, candidate, base());
  assert(replayed, "the replay should produce a creature");

  assertAlmostEquals(
    neuronOf(replayed, "other")?.bias ?? 0,
    0.9,
    1e-12,
    "a neuron the removal did not change must keep the target's own value",
  );
});

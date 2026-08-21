import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import {
  CANONICAL_CONSTANT_UUIDS,
  mergeRedundantConstants,
} from "@compact/ConstantMerge.ts";

// Issue #3808: IF-squash tree generation piles up one constant per branch, each
// with its own bias, because the constant fold cannot absorb a producer feeding
// an aggregate consumer. These tests exercise the merge pass on its own; the
// end-to-end behaviour (identical error, improved score) lives in
// CompactCreatureConstantMerge.ts.

/** UUIDs of every `type:"constant"` neuron left in the export. */
function constantUuids(json: CreatureExport): string[] {
  return json.neurons
    .filter((neuron) => neuron.type === "constant")
    .map((neuron) => neuron.uuid ?? "");
}

/** Look up a synapse by its wire endpoints. */
function findSynapse(json: CreatureExport, from: string, to: string) {
  const byId = new Map(json.neurons.map((n) => [n.id, n.uuid]));
  return json.synapses.find((s) =>
    (s.fromUUID ?? byId.get(s.fromId)) === from &&
    (s.toUUID ?? byId.get(s.toId)) === to
  );
}

/** Count of (from, to) pairs carrying more than one synapse. */
function duplicateEndpointPairs(json: CreatureExport): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const synapse of json.synapses) {
    const key = `${synapse.fromId}:${synapse.toId}`;
    if (seen.has(key)) duplicates++;
    seen.add(key);
  }
  return duplicates;
}

/** An IF fed a different constant on each of its three synapse roles. */
function ifWithThreeConstants(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-cond", bias: 0.5 },
      { type: "constant", uuid: "const-pos", bias: -0.25 },
      { type: "constant", uuid: "const-neg", bias: 2 },
      { type: "hidden", uuid: "if-neuron", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // A varying condition input keeps the IF alive (no constant collapse).
      {
        fromUUID: "input-0",
        toUUID: "if-neuron",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "const-cond",
        toUUID: "if-neuron",
        weight: 0.4,
        type: "condition",
      },
      {
        fromUUID: "input-1",
        toUUID: "if-neuron",
        weight: 0.7,
        type: "positive",
      },
      {
        fromUUID: "const-pos",
        toUUID: "if-neuron",
        weight: 0.6,
        type: "positive",
      },
      {
        fromUUID: "const-neg",
        toUUID: "if-neuron",
        weight: 0.3,
        type: "negative",
      },
      { fromUUID: "if-neuron", toUUID: "output-0", weight: 1 },
    ],
  };
}

Deno.test("mergeRedundantConstants - one canonical constant per IF role", () => {
  const json = ifWithThreeConstants();

  const result = mergeRedundantConstants(json);

  assert(result.changed, "the three constants should have been merged");
  assertEquals(result.removedNeurons, 3, "all three originals are retired");

  assertEquals(
    constantUuids(json).sort(),
    [...CANONICAL_CONSTANT_UUIDS].sort(),
    "exactly the three canonical constants remain",
  );
  for (const neuron of json.neurons) {
    if (neuron.type !== "constant") continue;
    assertEquals(neuron.bias, 1, `${neuron.uuid} must carry bias 1`);
  }

  // Each original bias moved onto the outgoing weight: w · b.
  const inbound = json.synapses.filter((s) => s.toUUID === "if-neuron");
  const condition = inbound.filter((s) => s.type === "condition");
  const positive = inbound.filter((s) => s.type === "positive");
  const negative = inbound.filter((s) => s.type === "negative");

  const constantCondition = condition.find((s) => s.fromUUID !== "input-0");
  assert(constantCondition, "the condition constant survives as an edge");
  assertAlmostEquals(constantCondition!.weight, 0.4 * 0.5, 1e-12);

  const constantPositive = positive.find((s) => s.fromUUID !== "input-1");
  assert(constantPositive, "the positive constant survives as an edge");
  assertAlmostEquals(constantPositive!.weight, 0.6 * -0.25, 1e-12);

  assertEquals(negative.length, 1);
  assertAlmostEquals(negative[0].weight, 0.3 * 2, 1e-12);

  // The three rewired edges come from three distinct canonical constants, so
  // no (from, to) pair is duplicated — creatureValidate rejects those.
  const froms = new Set(
    [
      constantCondition!.fromUUID,
      constantPositive!.fromUUID,
      negative[0]
        .fromUUID,
    ],
  );
  assertEquals(froms.size, 3, "one canonical constant per role");
  assertEquals(duplicateEndpointPairs(json), 0);
});

Deno.test("mergeRedundantConstants - is a fixpoint (re-running changes nothing)", () => {
  const json = ifWithThreeConstants();

  assert(mergeRedundantConstants(json).changed);
  const after = JSON.stringify(json);

  const second = mergeRedundantConstants(json);
  assertEquals(second.changed, false, "already-canonical constants are stable");
  assertEquals(JSON.stringify(json), after, "the export is untouched");
});

Deno.test("mergeRedundantConstants - sums constants sharing one IF role", () => {
  const json: CreatureExport = {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-a", bias: 0.5 },
      { type: "constant", uuid: "const-b", bias: 4 },
      { type: "hidden", uuid: "if-neuron", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "if-neuron",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "const-a",
        toUUID: "if-neuron",
        weight: 0.6,
        type: "positive",
      },
      // Same role as const-a: an IF sums the values within a role, so both fold
      // into one edge from one canonical constant.
      {
        fromUUID: "const-b",
        toUUID: "if-neuron",
        weight: 0.25,
        type: "positive",
      },
      { fromUUID: "input-1", toUUID: "if-neuron", weight: 1, type: "negative" },
      { fromUUID: "if-neuron", toUUID: "output-0", weight: 1 },
    ],
  };

  const result = mergeRedundantConstants(json);

  assert(result.changed);
  assertEquals(constantUuids(json), ["constant-0"], "one constant is enough");
  const merged = findSynapse(json, "constant-0", "if-neuron");
  assert(merged, "the summed edge exists");
  assertAlmostEquals(merged!.weight, 0.6 * 0.5 + 0.25 * 4, 1e-12);
  assertEquals(merged!.type, "positive");
  assertEquals(duplicateEndpointPairs(json), 0);
});

Deno.test("mergeRedundantConstants - never sums into a MAXIMUM, and stops at three slots", () => {
  // MAXIMUM reads every inbound value separately, so each constant needs its
  // own canonical source. With four constants the fourth has no free slot and
  // must keep its original neuron rather than duplicate a (from, to) pair.
  const json: CreatureExport = {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-a", bias: 0.5 },
      { type: "constant", uuid: "const-b", bias: -2 },
      { type: "constant", uuid: "const-c", bias: 3 },
      { type: "constant", uuid: "const-d", bias: 0.25 },
      { type: "hidden", uuid: "max-neuron", squash: "MAXIMUM", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "max-neuron", weight: 1 },
      { fromUUID: "const-a", toUUID: "max-neuron", weight: 0.6 },
      { fromUUID: "const-b", toUUID: "max-neuron", weight: 0.7 },
      { fromUUID: "const-c", toUUID: "max-neuron", weight: 0.8 },
      { fromUUID: "const-d", toUUID: "max-neuron", weight: 0.9 },
      { fromUUID: "max-neuron", toUUID: "output-0", weight: 1 },
    ],
  };

  const result = mergeRedundantConstants(json);

  assert(result.changed);
  assertEquals(result.removedNeurons, 3, "three of the four merge away");
  assertEquals(
    constantUuids(json).sort(),
    ["const-d", "constant-0", "constant-1", "constant-2"],
    "the surplus constant keeps its own neuron",
  );

  // The retained constant is untouched: bias and weight both unchanged.
  const retained = json.neurons.find((n) => n.uuid === "const-d");
  assertEquals(retained!.bias, 0.25);
  assertEquals(findSynapse(json, "const-d", "max-neuron")!.weight, 0.9);

  for (
    const [slot, product] of [[0, 0.6 * 0.5], [1, 0.7 * -2], [
      2,
      0.8 * 3,
    ]] as const
  ) {
    const edge = findSynapse(
      json,
      CANONICAL_CONSTANT_UUIDS[slot],
      "max-neuron",
    );
    assert(edge, `canonical slot ${slot} feeds the MAXIMUM`);
    assertAlmostEquals(edge!.weight, product, 1e-12);
  }
  assertEquals(duplicateEndpointPairs(json), 0);
});

Deno.test("mergeRedundantConstants - leaves frozen constants and frozen synapses alone", () => {
  const json: CreatureExport = {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-frozen", bias: 0.5, frozen: true },
      { type: "constant", uuid: "const-locked-edge", bias: 0.75 },
      { type: "hidden", uuid: "if-neuron", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "if-neuron",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "const-frozen",
        toUUID: "if-neuron",
        weight: 0.6,
        type: "positive",
      },
      {
        fromUUID: "const-locked-edge",
        toUUID: "if-neuron",
        weight: 0.3,
        type: "negative",
        frozen: true,
      },
      { fromUUID: "if-neuron", toUUID: "output-0", weight: 1 },
    ],
  };

  const result = mergeRedundantConstants(json);

  assertEquals(result.changed, false, "nothing is eligible");
  assertEquals(
    constantUuids(json).sort(),
    ["const-frozen", "const-locked-edge"],
    "both constants survive with their own UUIDs",
  );
  assertEquals(json.neurons.find((n) => n.uuid === "const-frozen")!.bias, 0.5);
  assertEquals(
    findSynapse(json, "const-locked-edge", "if-neuron")!.weight,
    0.3,
  );
});

Deno.test("mergeRedundantConstants - reuses a canonical constant already present", () => {
  const json: CreatureExport = {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 1,
    output: 1,
    neurons: [
      { type: "constant", uuid: "constant-0", bias: 1 },
      { type: "constant", uuid: "const-extra", bias: 0.5 },
      { type: "hidden", uuid: "if-neuron", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      {
        fromUUID: "input-0",
        toUUID: "if-neuron",
        weight: 1,
        type: "condition",
      },
      {
        fromUUID: "constant-0",
        toUUID: "if-neuron",
        weight: 0.6,
        type: "positive",
      },
      {
        fromUUID: "const-extra",
        toUUID: "if-neuron",
        weight: 0.3,
        type: "negative",
      },
      { fromUUID: "if-neuron", toUUID: "output-0", weight: 1 },
    ],
  };
  normaliseCreatureExport(json);

  const result = mergeRedundantConstants(json);

  assert(result.changed);
  assertEquals(
    constantUuids(json).sort(),
    ["constant-0", "constant-1"],
    "the occupied slot is skipped, the next free one is used",
  );
  assertEquals(findSynapse(json, "constant-0", "if-neuron")!.weight, 0.6);
  assertAlmostEquals(
    findSynapse(json, "constant-1", "if-neuron")!.weight,
    0.3 * 0.5,
    1e-12,
  );
  assertEquals(duplicateEndpointPairs(json), 0);
});

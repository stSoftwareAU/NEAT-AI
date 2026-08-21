import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { exportJSONUnchecked } from "@creature/CreatureSerialization.ts";
import { mergeParallelBridges } from "@compact/ParallelBridgeMerge.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #3809: `mergeParallelBridges` belongs to the safe (exact, lossless)
 * compaction floor, but on IF-forest creatures it changed the outputs and
 * emitted backward synapses that `loadFrom` then stripped. Two root causes:
 *
 * 1. It merged bridges feeding an **aggregation** target (`IF`, `MAXIMUM`, …).
 *    Collapsing several of those inbound synapses into one is not the same
 *    computation — and for `IF` the condition sum drives a discontinuous
 *    branch, so even a rounding-sized shift can swing the output.
 * 2. It merged into the **first** bridge of the group. Every other bridge's
 *    source then had to reach a neuron that loads earlier than it does, which
 *    is a backward edge on a forward-only creature.
 */

/** Load-order index of every neuron: inputs first, then export order. */
function positions(json: CreatureExport): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < json.input; i++) map.set(i, i);
  let position = json.input;
  for (const neuron of json.neurons) {
    map.set(neuron.id!, position++);
  }
  return map;
}

/** Every synapse that would load as a backward (recurrent) edge. */
function backwardSynapses(json: CreatureExport): string[] {
  const position = positions(json);
  const backward: string[] = [];
  for (const synapse of json.synapses) {
    const from = position.get(synapse.fromId!);
    const to = position.get(synapse.toId!);
    assert(from !== undefined, `unknown source ${synapse.fromId}`);
    assert(to !== undefined, `unknown target ${synapse.toId}`);
    if (from! >= to!) {
      backward.push(`${synapse.fromUUID ?? from}->${synapse.toUUID ?? to}`);
    }
  }
  return backward;
}

/** Worst absolute output difference over `rows` random inputs. */
function worstOutputDelta(
  before: Creature,
  after: Creature,
  rows: number,
): number {
  let worst = 0;
  for (let r = 0; r < rows; r++) {
    const row = new Float32Array(before.input);
    for (let i = 0; i < row.length; i++) row[i] = Math.random() * 2 - 1;
    const expected = before.activate(row, false);
    const actual = after.activate(row, false);
    for (let o = 0; o < before.output; o++) {
      worst = Math.max(worst, Math.abs(actual[o] - expected[o]));
    }
  }
  return worst;
}

/** Runs the pass to a fixpoint — it merges at most one group per call. */
function mergeToFixpoint(json: CreatureExport): number {
  let removed = 0;
  for (let pass = 0; pass < 1000; pass++) {
    const result = mergeParallelBridges(json);
    if (result.removedNeurons === 0) return removed;
    removed += result.removedNeurons;
  }
  throw new Error("parallel bridge merge did not reach a fixpoint");
}

Deno.test("parallel bridge merge: IF target is declined", () => {
  // Two IDENTITY bridges feeding the same IF condition. An IF sums per role,
  // so the algebra looks additive — but the sum selects a branch, so folding
  // the two synapses into one is not lossless.
  const json: CreatureExport = {
    forwardOnly: true,
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "bridge-a", squash: "IDENTITY", bias: 0.25 },
      { type: "hidden", uuid: "bridge-b", squash: "IDENTITY", bias: -0.5 },
      { type: "output", uuid: "output-0", squash: "IF", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "bridge-a", weight: 0.5 },
      {
        fromUUID: "bridge-a",
        toUUID: "output-0",
        weight: 2,
        type: "condition",
      },
      { fromUUID: "input-1", toUUID: "bridge-b", weight: 0.3 },
      {
        fromUUID: "bridge-b",
        toUUID: "output-0",
        weight: 1.5,
        type: "condition",
      },
      { fromUUID: "input-2", toUUID: "output-0", weight: 1, type: "positive" },
      { fromUUID: "input-2", toUUID: "output-0", weight: -1, type: "negative" },
    ],
  };

  assertEquals(
    mergeParallelBridges(json).removedNeurons,
    0,
    "an IF target must not have its inbound synapses collapsed",
  );
  assertEquals(json.neurons.length, 3, "both bridges survive");
});

Deno.test("parallel bridge merge: MAXIMUM target is declined", () => {
  const json: CreatureExport = {
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "bridge-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "bridge-b", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "MAXIMUM", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "bridge-a", weight: 0.5 },
      { fromUUID: "bridge-a", toUUID: "output-0", weight: 2 },
      { fromUUID: "input-1", toUUID: "bridge-b", weight: 0.3 },
      { fromUUID: "bridge-b", toUUID: "output-0", weight: 1.5 },
    ],
  };

  assertEquals(
    mergeParallelBridges(json).removedNeurons,
    0,
    "MAXIMUM picks one inbound value — it must not be pre-summed",
  );
});

Deno.test("parallel bridge merge: merges into the bridge that loads last", async () => {
  await initWasmForTests();

  // `bridge-early` loads before `late-source`, which feeds `bridge-late`.
  // Merging into `bridge-early` would point `late-source` backwards.
  const json: CreatureExport = {
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "bridge-early", squash: "IDENTITY", bias: 0.25 },
      { type: "hidden", uuid: "late-source", squash: "LOGISTIC", bias: 0.1 },
      { type: "hidden", uuid: "bridge-late", squash: "IDENTITY", bias: -0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.75 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "bridge-early", weight: 0.5 },
      { fromUUID: "bridge-early", toUUID: "output-0", weight: 2 },
      { fromUUID: "input-1", toUUID: "late-source", weight: 0.8 },
      { fromUUID: "late-source", toUUID: "bridge-late", weight: 0.3 },
      { fromUUID: "bridge-late", toUUID: "output-0", weight: 1.5 },
    ],
  };

  const before = Creature.fromJSON(json, false);
  const merged = exportJSONUnchecked(before);

  assertEquals(mergeParallelBridges(merged).removedNeurons, 1);
  assertEquals(
    backwardSynapses(merged),
    [],
    "the redirected synapse must stay forward",
  );

  const survivors = merged.neurons
    .filter((n) => n.type === "hidden" && n.squash === "IDENTITY")
    .map((n) => n.uuid);
  assertEquals(survivors, ["bridge-late"], "the later bridge is kept");

  const redirected = merged.synapses.find((s) => s.fromUUID === "input-0");
  assert(redirected, "input-0 still feeds the merged bridge");
  assertEquals(
    redirected.toUUID,
    "bridge-late",
    "both endpoints of a redirected synapse move together",
  );

  // Loads without stripping anything, and computes the same outputs.
  const after = Creature.fromJSON(merged, false, "issue-3809");
  assertEquals(after.synapses.length, before.synapses.length - 1);
  assertAlmostEquals(worstOutputDelta(before, after, 50), 0, 1e-6);
});

Deno.test("parallel bridge merge: a source that loads after the kept bridge is left alone", () => {
  // Recurrent creature: `back-fed`'s inbound synapse comes from a neuron that
  // loads later, so it carries the previous pass's activation. Redirecting it
  // onto a bridge that loads even later would silently make it a same-pass
  // value, so that bridge is excluded — the other two still merge.
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "back-fed", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "later", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "bridge-b", squash: "IDENTITY", bias: 0.2 },
      { type: "hidden", uuid: "bridge-c", squash: "IDENTITY", bias: -0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "later", toUUID: "back-fed", weight: 0.4 },
      { fromUUID: "back-fed", toUUID: "output-0", weight: 1.1 },
      { fromUUID: "input-0", toUUID: "later", weight: 0.7 },
      { fromUUID: "input-1", toUUID: "bridge-b", weight: 0.5 },
      { fromUUID: "bridge-b", toUUID: "output-0", weight: 2 },
      { fromUUID: "input-2", toUUID: "bridge-c", weight: 0.3 },
      { fromUUID: "bridge-c", toUUID: "output-0", weight: 1.5 },
    ],
  };

  assertEquals(
    mergeParallelBridges(json).removedNeurons,
    1,
    "only bridge-b folds into bridge-c",
  );

  const remaining = json.neurons.map((n) => n.uuid);
  assertEquals(remaining, ["back-fed", "later", "bridge-c", "output-0"]);

  const backFedInbound = json.synapses.find((s) => s.fromUUID === "later");
  assert(backFedInbound, "the backward synapse survives");
  assertEquals(
    backFedInbound.toUUID,
    "back-fed",
    "a backward synapse must not be redirected forwards",
  );
});

Deno.test(
  "GRQ-23-forests fixture — parallel bridge merge is exact and forward-only",
  async () => {
    await initWasmForTests();

    // The IF-forest creature from Issue #3808. Before the fix this pass moved
    // the outputs by ~1e-1 and emitted hundreds of `forest-*-if1 ->
    // forest-*-relay2` backward synapses.
    const json: CreatureExport = JSON.parse(
      await Deno.readTextFile("./test/data/grq-23-forests-constants.json"),
    );
    const before = Creature.fromJSON(json, false);

    const merged = exportJSONUnchecked(before);
    mergeToFixpoint(merged);

    assertEquals(
      backwardSynapses(merged).slice(0, 5),
      [],
      "the merge must not emit backward synapses on a forward-only creature",
    );

    // Strict load: `throwOnRecurrent` defaults to "forwardOnly", so a stripped
    // synapse would throw here rather than degrade the creature silently.
    const after = Creature.fromJSON(merged, false, "issue-3809");
    assertEquals(
      after.synapses.length,
      before.synapses.length -
        (before.neurons.length - after.neurons.length),
      "each merged-away bridge takes exactly its outbound synapse with it",
    );

    assertEquals(
      worstOutputDelta(before, after, 25),
      0,
      "the safe compaction floor must not move the outputs at all",
    );
  },
);

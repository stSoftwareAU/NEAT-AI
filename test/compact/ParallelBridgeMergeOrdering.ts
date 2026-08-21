import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { exportJSONUnchecked } from "@creature/CreatureSerialization.ts";
import { mergeParallelBridges } from "@compact/ParallelBridgeMerge.ts";
import { mergeRedundantConstants } from "@compact/ConstantMerge.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #3809: `mergeParallelBridges` is advertised as an exact (lossless)
 * compaction pass, but on the fleet's IF-forest creatures it drifted the
 * outputs and emitted recurrent synapses. Two defects:
 *
 * 1. **Ordering.** It kept an arbitrary group member — the first in the
 *    export's neuron order — and redirected every other member's inbound
 *    synapse onto it. That order *is* the activation order `loadFrom`
 *    rebuilds, so any source sitting after the kept neuron became a backward
 *    synapse, stripped at load on a forward-only creature.
 * 2. **Non-additive targets.** It merged bridges feeding an aggregation
 *    neuron, where the contributions are not summed. An IF neuron reads its
 *    `condition`, `positive` and `negative` synapses as three separate sums,
 *    so folding a mixed group into one synapse moved terms between them.
 */

/** Deterministic input rows — a flaky output-delta bound helps nobody. */
function inputRows(inputs: number, rows: number): Float32Array[] {
  const data: Float32Array[] = [];
  for (let r = 0; r < rows; r++) {
    const row = new Float32Array(inputs);
    for (let i = 0; i < inputs; i++) {
      row[i] = Math.sin((i + 1) * 0.7 + r * 1.31);
    }
    data.push(row);
  }
  return data;
}

/**
 * Deterministic input rows drawn from dyadic fractions, so every product and
 * sum along the way is exact in float32 and a merge that is exact in real
 * arithmetic must be bit-for-bit exact here too.
 */
function dyadicRows(inputs: number, rows: number): Float32Array[] {
  const data: Float32Array[] = [];
  for (let r = 0; r < rows; r++) {
    const row = new Float32Array(inputs);
    for (let i = 0; i < inputs; i++) {
      row[i] = ((i + r) % 5) / 4 - 0.5;
    }
    data.push(row);
  }
  return data;
}

/** Worst absolute output difference over the given rows. */
function worstOutputDelta(
  before: Creature,
  after: Creature,
  rows: Float32Array[],
): number {
  let worst = 0;
  for (const row of rows) {
    const expected = before.activate(row, false);
    const actual = after.activate(row, false);
    for (let o = 0; o < before.output; o++) {
      const delta = Math.abs(actual[o] - expected[o]);
      if (delta > worst) worst = delta;
    }
  }
  return worst;
}

/**
 * Two IDENTITY bridge neurons feeding the same output, where the second
 * bridge's source neuron sits *after* the first bridge in the neuron order.
 */
function lateSourceBridges(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "bridge-early", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "source-late", squash: "LOGISTIC", bias: -0.4 },
      { type: "hidden", uuid: "bridge-late", squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "bridge-early", weight: 0.5 },
      { fromUUID: "bridge-early", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-1", toUUID: "source-late", weight: 0.9 },
      { fromUUID: "source-late", toUUID: "bridge-late", weight: 0.3 },
      { fromUUID: "bridge-late", toUUID: "output-0", weight: 1.5 },
    ],
  };
}

Deno.test(
  "parallel bridge merge: a source after the first bridge stays forward",
  async () => {
    await initWasmForTests();

    const original = Creature.fromJSON(lateSourceBridges(), false, "#3809");

    const merged = exportJSONUnchecked(original);
    const result = mergeParallelBridges(merged);
    assertEquals(result.removedNeurons, 1, "the two bridges must merge");

    // The default recurrent gate throws on a forward-only creature carrying a
    // backward synapse, so this load is the structural assertion.
    const mergedCreature = Creature.fromJSON(merged, false, "#3809");
    assertEquals(
      mergedCreature.synapses.length,
      merged.synapses.length,
      "no synapse may be stripped at load",
    );

    assertAlmostEquals(
      worstOutputDelta(original, mergedCreature, inputRows(2, 25)),
      0,
      1e-6,
      "merging must not change the outputs",
    );
  },
);

Deno.test(
  "parallel bridge merge: a backward bridge edge is declined",
  async () => {
    await initWasmForTests();

    // A recurrent creature where `bridge-b` is fed from behind it, so its own
    // outbound edge runs backwards into the shared target. The merge cannot
    // place a single neuron that keeps both members' timing — it must decline
    // rather than silently re-time the network.
    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "bridge-a", squash: "IDENTITY", bias: 0.1 },
        { type: "hidden", uuid: "target", squash: "IDENTITY", bias: 0 },
        { type: "hidden", uuid: "back-source", squash: "LOGISTIC", bias: 0 },
        { type: "hidden", uuid: "bridge-b", squash: "IDENTITY", bias: 0.2 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "bridge-a", weight: 0.5 },
        { fromUUID: "bridge-a", toUUID: "target", weight: 2.0 },
        { fromUUID: "target", toUUID: "back-source", weight: 0.7 },
        { fromUUID: "back-source", toUUID: "bridge-b", weight: 0.3 },
        { fromUUID: "bridge-b", toUUID: "target", weight: 1.5 },
        { fromUUID: "target", toUUID: "output-0", weight: 1.0 },
      ],
    };

    const result = mergeParallelBridges(json);
    assertEquals(
      result.removedNeurons,
      0,
      "a backward bridge edge must not be merged",
    );
  },
);

/**
 * `count` IDENTITY bridges feeding one aggregation neuron, alternating the
 * synapse type when `typed` is set (as the fleet's IF forests do).
 */
function bridgesIntoAggregate(
  squash: string,
  typed: boolean,
  count: number,
): CreatureExport {
  const json: CreatureExport = {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: count,
    output: 1,
    neurons: [],
    synapses: [],
  };

  const types = ["condition", "positive", "negative"] as const;
  for (let i = 0; i < count; i++) {
    json.neurons.push({
      type: "hidden",
      uuid: `bridge-${i}`,
      squash: "IDENTITY",
      // Exactly representable in float32 so the merge is bit-for-bit exact.
      bias: (i % 5) / 8,
    });
    json.synapses.push({
      fromUUID: `input-${i}`,
      toUUID: `bridge-${i}`,
      weight: 0.5 + (i % 3) / 4,
    });
    json.synapses.push({
      fromUUID: `bridge-${i}`,
      toUUID: "aggregate",
      weight: 0.25 * ((i % 4) + 1),
      type: typed ? types[i % types.length] : undefined,
    });
  }

  json.neurons.push({ type: "hidden", uuid: "aggregate", squash, bias: 0.5 });
  json.neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  json.synapses.push({
    fromUUID: "aggregate",
    toUUID: "output-0",
    weight: 1,
  });
  return json;
}

Deno.test(
  "parallel bridge merge: MAXIMUM target is declined",
  async () => {
    await initWasmForTests();

    // MAXIMUM picks one contribution rather than summing them, so folding the
    // bridges into a single synapse would change the target's value.
    const result = mergeParallelBridges(
      bridgesIntoAggregate("MAXIMUM", false, 6),
    );
    assertEquals(
      result.removedNeurons,
      0,
      "a non-additive target must not be merged",
    );
  },
);

Deno.test(
  "parallel bridge merge: IF target merges per synapse type, never conditions",
  async () => {
    await initWasmForTests();

    const json = bridgesIntoAggregate("IF", true, 12);
    const original = Creature.fromJSON(json, false, "#3809");
    const rows = dyadicRows(original.input, 25);

    const merged = exportJSONUnchecked(original);
    const result = mergeParallelBridges(merged);
    // 12 bridges: 4 condition, 4 positive, 4 negative. One group merges per
    // pass, and the condition group is off limits, so 3 neurons go.
    assertEquals(result.removedNeurons, 3, "one same-type group must merge");

    const mergedCreature = Creature.fromJSON(merged, false, "#3809");
    assertEquals(
      mergedCreature.synapses.length,
      merged.synapses.length,
      "no synapse may be stripped at load",
    );

    // Every surviving condition synapse still comes straight from a bridge.
    const conditionSources = merged.synapses
      .filter((s) => s.type === "condition")
      .map((s) => s.fromUUID);
    assertEquals(conditionSources.length, 4, "conditions must be untouched");

    // Dyadic weights, biases and inputs — the merge must be bit-for-bit exact.
    assertEquals(
      worstOutputDelta(original, mergedCreature, rows),
      0,
      "merging value synapses of one type must be exact",
    );
  },
);

Deno.test(
  "GRQ-23-forests fixture — parallel bridge merge no longer drifts",
  async () => {
    await initWasmForTests();

    // The worst GRQ-sampler offender (Issue #3808): 2 538 exported neurons of
    // IF forests. Merging their bridges used to emit hundreds of recurrent
    // synapses (stripped at load) and drift the outputs by ~1e-1.
    const json: CreatureExport = JSON.parse(
      await Deno.readTextFile("./test/data/grq-23-forests-constants.json"),
    );
    const creature = Creature.fromJSON(json, false, "#3809");

    const exported = exportJSONUnchecked(creature);
    mergeRedundantConstants(exported);
    const result = mergeParallelBridges(exported);
    assert(result.removedNeurons > 0, "the forest bridges must merge");

    // Loading with the default gate throws on any backward synapse, and the
    // synapse count proves none was stripped.
    const mergedCreature = Creature.fromJSON(exported, false, "#3809");
    assertEquals(
      mergedCreature.synapses.length,
      exported.synapses.length,
      "no synapse may be stripped at load",
    );

    // Not bit-exact: collapsing 158 bridges re-associates a float32 sum and
    // rounds it once instead of 158 times. The residual is ~1e-6 on outputs
    // of magnitude ~2 — five orders of magnitude below the ~1e-1 drift the
    // recurrent synapses used to cause.
    const delta = worstOutputDelta(
      creature,
      mergedCreature,
      inputRows(creature.input, 25),
    );
    assert(delta < 1e-4, `worst output delta ${delta.toExponential(3)}`);
  },
);

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { compactCreature } from "@compact/CompactCreature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { mergeParallelBridges } from "@compact/ParallelBridgeMerge.ts";

/**
 * Issue #3637: the parallel-bridge merge algorithm now lives in exactly one
 * place — `mergeParallelBridges`. These tests pin the IDENTITY behaviour that
 * the retired IDENTITY-only pass used to provide, so the single remaining
 * implementation stays honest about the whole contract.
 */

function identityBridgeExport(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h0", weight: 0.5 },
      { fromUUID: "h0", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.5 },
    ],
  };
}

Deno.test("parallel merge: IDENTITY bridges merge from a UUID-only export", () => {
  // The retired IDENTITY-only pass required callers to normalise integer ids
  // first; the surviving generalised pass normalises internally, so a plain
  // UUID-only export (the canonical wire format) merges without preparation.
  const json = identityBridgeExport();

  const result = mergeParallelBridges(json);
  assertEquals(
    result.removedNeurons,
    1,
    "One IDENTITY bridge should be merged",
  );

  const hidden = json.neurons.filter((n) => n.type === "hidden");
  assertEquals(hidden.length, 1, "One hidden neuron should remain");
  assertEquals(hidden[0].squash, "IDENTITY");

  // bias_merged = 2.0 * 0.1 + 1.5 * 0.2 = 0.5
  assertAlmostEquals(hidden[0].bias, 0.5, 1e-12, "Merged bias incorrect");

  // w_merged_i = w_out_i * w_in_i → input-0: 2.0 * 0.5 = 1.0, input-1: 1.5 * 0.3 = 0.45
  const inbound = new Map(
    json.synapses
      .filter((s) => s.toId === hidden[0].id)
      .map((s) => [s.fromId, s.weight] as const),
  );
  assertAlmostEquals(inbound.get(0)!, 1.0, 1e-12);
  assertAlmostEquals(inbound.get(1)!, 0.45, 1e-12);
});

Deno.test("parallel merge: compaction still collapses IDENTITY bridges without behaviour change", () => {
  const original = Creature.fromJSON(identityBridgeExport());
  const samples = [
    new Float32Array([0.25, -0.75]),
    new Float32Array([1, 1]),
    new Float32Array([-2, 0.5]),
  ];
  const before = samples.map((s) => original.activate(s)[0]);

  const compacted = compactCreature(original, false);
  assert(compacted, "Expected compaction to occur");
  compacted.validate();

  const hidden = compacted.exportJSON().neurons.filter((n) =>
    n.type === "hidden"
  );
  assertEquals(hidden.length, 1, "Parallel IDENTITY bridges should collapse");

  samples.forEach((sample, i) => {
    assertAlmostEquals(
      compacted.activate(sample)[0],
      before[i],
      1e-6, // Float32 activation precision
      `Activation changed for sample ${i}`,
    );
  });
});

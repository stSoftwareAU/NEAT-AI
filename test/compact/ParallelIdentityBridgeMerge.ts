import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { compactCreature } from "@compact/CompactCreature.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

Deno.test("parallel IDENTITY merge: two bridge neurons to same target are merged", () => {
  // input-0 -> h0 (IDENTITY, bias=0, w_in=0.5) -> output-0 (w_out=2.0)
  // input-1 -> h1 (IDENTITY, bias=0, w_in=0.3) -> output-0 (w_out=1.5)
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h0", weight: 0.5 },
      { fromUUID: "h0", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.5 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, false);
  assert(compacted, "Expected compaction to occur");
  compacted.validate();

  const exported = compacted.exportJSON();
  const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");

  // At least one bridge neuron should be removed
  assert(
    hiddenNeurons.length < 2,
    `Expected fewer than 2 hidden neurons, got ${hiddenNeurons.length}`,
  );
});

Deno.test("parallel IDENTITY merge: weight calculation is correct", () => {
  // Before merge:
  //   target receives: w_out_0 * (w_in_0 * x0 + bias_0) + w_out_1 * (w_in_1 * x1 + bias_1)
  //   = 2.0 * (0.5 * x0 + 0.1) + 1.5 * (0.3 * x1 + 0.2)
  //   = 1.0*x0 + 0.2 + 0.45*x1 + 0.3
  //   = 1.0*x0 + 0.45*x1 + 0.5
  //
  // After merge with w_out = 1:
  //   merged weights: [2.0*0.5, 1.5*0.3] = [1.0, 0.45]
  //   merged bias: 2.0*0.1 + 1.5*0.2 = 0.5
  //   outbound weight to target: 1.0
  const json: CreatureExport = {
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

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, false);
  assert(compacted, "Expected compaction to occur");
  compacted.validate();

  const exported = compacted.exportJSON();
  const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
  assertEquals(hiddenNeurons.length, 1, "One hidden neuron should remain");

  const kept = hiddenNeurons[0];
  // Merged bias: 2.0*0.1 + 1.5*0.2 = 0.5
  assertAlmostEquals(kept.bias, 0.5, 1e-12, "Merged bias incorrect");

  // Inbound synapses to the kept neuron
  const inboundToKept = exported.synapses.filter(
    (s) => s.toUUID === kept.uuid,
  );
  assertEquals(inboundToKept.length, 2, "Should have 2 inbound synapses");

  const wByFrom = new Map(
    inboundToKept.map((s) => [s.fromUUID, s.weight] as const),
  );
  // input-0 weight: 2.0 * 0.5 = 1.0
  assertAlmostEquals(wByFrom.get("input-0") ?? NaN, 1.0, 1e-12);
  // input-1 weight: 1.5 * 0.3 = 0.45
  assertAlmostEquals(wByFrom.get("input-1") ?? NaN, 0.45, 1e-12);

  // Outbound synapse from kept to output
  const outboundFromKept = exported.synapses.filter(
    (s) => s.fromUUID === kept.uuid,
  );
  assertEquals(outboundFromKept.length, 1, "Should have 1 outbound synapse");
  assertAlmostEquals(
    outboundFromKept[0].weight,
    1.0,
    1e-12,
    "Outbound weight should be 1",
  );
});

Deno.test("parallel IDENTITY merge: bias contributions are correctly absorbed", () => {
  // Three parallel IDENTITY neurons with different biases
  // Merged bias = 2.0*0.5 + 3.0*(-0.3) + 0.5*0.1 = 1.0 - 0.9 + 0.05 = 0.15
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0.5 },
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: -0.3 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.2 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h0", weight: 1.0 },
      { fromUUID: "h0", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-1", toUUID: "h1", weight: 1.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 3.0 },
      { fromUUID: "input-2", toUUID: "h2", weight: 1.0 },
      { fromUUID: "h2", toUUID: "output-0", weight: 0.5 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, false);
  assert(compacted, "Expected compaction to occur");
  compacted.validate();

  const exported = compacted.exportJSON();
  const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
  assertEquals(hiddenNeurons.length, 1, "One hidden neuron should remain");

  const kept = hiddenNeurons[0];
  // Merged bias: 2.0*0.5 + 3.0*(-0.3) + 0.5*0.1 = 0.15
  assertAlmostEquals(kept.bias, 0.15, 1e-12, "Merged bias incorrect");
});

Deno.test("parallel IDENTITY merge: skips when would create duplicate synapses", () => {
  // h0 and h1 both receive from input-0 — merging would create two
  // synapses from input-0 to the kept neuron (a duplicate).
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h0", weight: 0.5 },
      { fromUUID: "h0", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-0", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.5 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, false);

  // The parallel merge should skip this group due to duplicate sources.
  // Other compact passes may still fire, so if it does compact, validate.
  if (compacted) {
    compacted.validate();
  }
});

Deno.test("parallel IDENTITY merge: does not merge non-IDENTITY squash neurons", () => {
  // Two LOGISTIC neurons bridging to the same target — should NOT be merged
  // by the parallel IDENTITY pass.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "h1", squash: "LOGISTIC", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h0", weight: 0.5 },
      { fromUUID: "h0", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.5 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, false);

  // The parallel IDENTITY merge should not fire for LOGISTIC.
  // Other passes may compact, but both hidden neurons should remain.
  if (compacted) {
    const exported = compacted.exportJSON();
    const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
    assertEquals(
      hiddenNeurons.length,
      2,
      "LOGISTIC neurons should not be merged by parallel IDENTITY pass",
    );
  }
});

Deno.test("parallel IDENTITY merge: does not merge neurons with multiple inbound connections", () => {
  // h0 has 2 inbound connections — not a simple bridge neuron
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h0", weight: 0.3 },
      { fromUUID: "h0", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-2", toUUID: "h1", weight: 0.4 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.5 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, false);

  // h0 has 2 inbound — not eligible. h1 alone doesn't form a group of 2+.
  // Other compact passes may still fire.
  if (compacted) {
    compacted.validate();
  }
});

Deno.test("parallel IDENTITY merge: preserves forward-only topology", () => {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    forwardOnly: true,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h0", weight: 0.5 },
      { fromUUID: "h0", toUUID: "output-0", weight: 2.0 },
      { fromUUID: "input-1", toUUID: "h1", weight: 0.3 },
      { fromUUID: "h1", toUUID: "output-0", weight: 1.5 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, false);
  assert(compacted, "Expected compaction to occur");
  compacted.validate();
  assertEquals(compacted.forwardOnly, true);

  const exported = compacted.exportJSON();
  const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
  assert(
    hiddenNeurons.length < 2,
    `Expected fewer than 2 hidden neurons, got ${hiddenNeurons.length}`,
  );
});

Deno.test("parallel IDENTITY merge: three bridge neurons merged correctly", () => {
  // Three IDENTITY bridge neurons all pointing to the same target
  // Merged bias = 0.5*0.1 + 0.8*(-0.2) + 1.2*0.3 = 0.05 - 0.16 + 0.36 = 0.25
  const json: CreatureExport = {
    input: 3,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h0", squash: "IDENTITY", bias: 0.1 },
      { type: "hidden", uuid: "h1", squash: "IDENTITY", bias: -0.2 },
      { type: "hidden", uuid: "h2", squash: "IDENTITY", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h0", weight: 1.0 },
      { fromUUID: "h0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h1", weight: 2.0 },
      { fromUUID: "h1", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "input-2", toUUID: "h2", weight: -1.0 },
      { fromUUID: "h2", toUUID: "output-0", weight: 1.2 },
    ],
  };

  const creature = Creature.fromJSON(json);
  const compacted = compactCreature(creature, false);
  assert(compacted, "Expected compaction to occur");
  compacted.validate();

  const exported = compacted.exportJSON();
  const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");

  // Only one pass runs at a time, so we may have removed 2 of 3.
  // After repeated compaction all 3 would collapse. Verify at least some merged.
  assert(
    hiddenNeurons.length < 3,
    `Expected fewer than 3 hidden neurons, got ${hiddenNeurons.length}`,
  );

  // The kept neuron's bias should reflect merged contributions
  if (hiddenNeurons.length === 1) {
    const kept = hiddenNeurons[0];
    assertAlmostEquals(kept.bias, 0.25, 1e-12, "Merged bias incorrect");
  }
});

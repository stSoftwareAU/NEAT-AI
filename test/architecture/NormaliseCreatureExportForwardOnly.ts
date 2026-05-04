/**
 * NormaliseCreatureExport forward-only invariant test (Issue #2515).
 *
 * `normaliseCreatureExport` renumbers neuron IDs (especially for output
 * neurons whose IDs may be re-pointed when a candidate carries the wrong
 * ID) and back-propagates those renames to the synapses' `fromId` /
 * `toId` fields.
 *
 * The audit in #2515 calls out this function as a place where back-edges
 * could be introduced if the renumbering ever pointed a synapse at a
 * lower-indexed neuron. This test pins the invariant: for a forward-only
 * creature, no synapse leaves `normaliseCreatureExport` violating
 * `from < to` when measured against the canonical neuron index built by
 * `buildIdToIndexMap` (input neurons first, then `neurons` array order).
 */

import { assert } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { buildIdToIndexMap } from "@discovery/CandidateApplication.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { initWasmForTests } from "../_initWasm.ts";

function assertSynapsesForwardOnly(
  json: CreatureExport,
  context: string,
): void {
  const idToIndex = buildIdToIndexMap(json);
  for (let i = 0; i < json.synapses.length; i++) {
    const s = json.synapses[i];
    const fromIndex = idToIndex.get(s.fromId!);
    const toIndex = idToIndex.get(s.toId!);
    assert(
      fromIndex !== undefined && toIndex !== undefined,
      `${context}: synapse[${i}] endpoint missing from idToIndex map ` +
        `(fromId=${s.fromId}, toId=${s.toId})`,
    );
    assert(
      fromIndex! < toIndex!,
      `${context}: synapse[${i}] violates forward-only ` +
        `(${s.fromId}@${fromIndex} -> ${s.toId}@${toIndex})`,
    );
  }
}

Deno.test("normaliseCreatureExport: preserves forward-only invariant on round-trip", async () => {
  await initWasmForTests();

  // Build a forward-only creature with two hidden layers and verify
  // that exporting + normalising preserves the forward-only invariant.
  const creature = new Creature(3, 2, {
    layers: [{ count: 4 }, { count: 3 }],
  });
  const json = creature.exportJSON();
  normaliseCreatureExport(json);
  assertSynapsesForwardOnly(json, "round-trip exportJSON");
});

Deno.test("normaliseCreatureExport: idempotent on already-resolved IDs", async () => {
  await initWasmForTests();

  const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const json = creature.exportJSON();
  normaliseCreatureExport(json);
  // Run again — idempotent, so the invariant must still hold.
  normaliseCreatureExport(json);
  assertSynapsesForwardOnly(json, "second normalise call");
});

Deno.test("normaliseCreatureExport: remaps output neuron with wrong ID without flipping edges", () => {
  // Construct an export where the output neuron carries a wrong ID
  // (positive integer instead of -1). The hidden→output synapse uses
  // UUID identity, so normaliseCreatureExport runs the renumbering
  // branch (instead of short-circuiting on already-resolved IDs) and
  // must rewrite the output neuron to outputNeuronId(0) = -1, then
  // update the synapse's `toId` to -1. The resulting topology must
  // still be forward-only.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        id: 1_000_005,
        uuid: "hidden-1",
        type: "hidden",
        squash: "IDENTITY",
        bias: 0,
      },
      {
        id: 999_999_999, // wrong: should be remapped to -1
        uuid: "output-0",
        type: "output",
        squash: "IDENTITY",
        bias: 0,
      },
    ],
    synapses: [
      // Force the renumbering branch to run by leaving fromId/toId
      // unresolved on at least one synapse — `isResolvedIds` returns
      // false, so the function does not short-circuit.
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromId: 1_000_005, toId: 999_999_999, weight: 0.4 },
    ],
  };

  normaliseCreatureExport(json);

  // Output neuron must be remapped to -1.
  const out = json.neurons.find((n) => n.type === "output");
  assert(out, "expected output neuron to be present");
  assert(out!.id === -1, `output id should be -1, got ${out!.id}`);
  // Synapse should now point to -1.
  const remapped = json.synapses.find((s) => s.fromId === 1_000_005);
  assert(remapped, "expected the hidden->output synapse to remain");
  assert(
    remapped!.toId === -1,
    `synapse toId should be remapped to -1, got ${remapped!.toId}`,
  );
  // Forward-only invariant: input(0) -> hidden(2) -> output(3).
  assertSynapsesForwardOnly(json, "wrong-output-id remap");
});

Deno.test("normaliseCreatureExport: UUID-keyed memetic input survives normalise without back-edges", () => {
  // Simulates a wire-format candidate (UUID-keyed, no integer IDs) — the
  // exact pattern used by discovery/breeding before normalisation. The
  // invariant must hold once IDs are resolved.
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { uuid: "hidden-A", type: "hidden", squash: "IDENTITY", bias: 0 },
      { uuid: "hidden-B", type: "hidden", squash: "IDENTITY", bias: 0 },
      { uuid: "output-0", type: "output", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-A", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-B", weight: 0.5 },
      { fromUUID: "hidden-A", toUUID: "hidden-B", weight: 0.4 },
      { fromUUID: "hidden-B", toUUID: "output-0", weight: 0.3 },
    ],
  };

  normaliseCreatureExport(json);

  // Every synapse should now have integer fromId/toId.
  for (const s of json.synapses) {
    assert(
      s.fromId !== undefined && s.toId !== undefined,
      `synapse missing resolved IDs: ${JSON.stringify(s)}`,
    );
  }
  assertSynapsesForwardOnly(json, "UUID-keyed wire format");
});

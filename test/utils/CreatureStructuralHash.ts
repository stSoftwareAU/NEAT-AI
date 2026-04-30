/**
 * Tests for the structural-hash helper used by loadFrom warnings (Issue #2500).
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { computeCreatureStructuralHash } from "@utils/CreatureStructuralHash.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

function makeExport(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "o-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-1", weight: 0.1 },
      { fromUUID: "h-1", toUUID: "o-0", weight: 0.2 },
    ],
  } as unknown as CreatureExport;
}

Deno.test("computeCreatureStructuralHash: stable for the same JSON", () => {
  const a = makeExport();
  const b = makeExport();
  assertEquals(
    computeCreatureStructuralHash(a),
    computeCreatureStructuralHash(b),
  );
});

Deno.test("computeCreatureStructuralHash: hex digits only, length 8", () => {
  const hash = computeCreatureStructuralHash(makeExport());
  assert(/^[0-9a-f]{8}$/.test(hash), `hash must be 8 hex chars, got ${hash}`);
});

Deno.test("computeCreatureStructuralHash: insensitive to synapse order", () => {
  const a = makeExport();
  const b = makeExport();
  b.synapses = [b.synapses[1], b.synapses[0]];
  assertEquals(
    computeCreatureStructuralHash(a),
    computeCreatureStructuralHash(b),
  );
});

Deno.test("computeCreatureStructuralHash: differs when topology changes", () => {
  const a = makeExport();
  const b = makeExport();
  // Add a recurrent self-loop on the output neuron.
  b.synapses.push({ fromUUID: "o-0", toUUID: "o-0", weight: 0.3 } as never);
  assertNotEquals(
    computeCreatureStructuralHash(a),
    computeCreatureStructuralHash(b),
  );
});

Deno.test("computeCreatureStructuralHash: differs when input/output change", () => {
  const a = makeExport();
  const b = makeExport();
  b.input = 3;
  assertNotEquals(
    computeCreatureStructuralHash(a),
    computeCreatureStructuralHash(b),
  );
});

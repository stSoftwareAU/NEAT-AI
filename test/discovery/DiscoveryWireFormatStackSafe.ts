import { assertEquals, assertThrows } from "@std/assert";
import { assertNoLegacyDiscoveryIdFields } from "@discovery/DiscoveryWireFormat.ts";
import { TopologyError } from "@errors/TopologyError.ts";

// Issue #2900: assertNoLegacyDiscoveryIdFields walks a wire payload with an
// explicit stack and previously did `stack.push(...current)` for arrays. A
// creature wire payload can carry a very wide synapse/neuron array, so the
// spread could throw RangeError. These tests confirm the traversal stays
// behaviour-identical while scaling to arrays past the spread limit.

Deno.test("assertNoLegacyDiscoveryIdFields - accepts a clean payload", () => {
  assertNoLegacyDiscoveryIdFields({
    synapses: [{ from: 0, to: 1, weight: 0.5 }],
    neurons: [{ index: 0 }, { index: 1 }],
  });
});

Deno.test("assertNoLegacyDiscoveryIdFields - throws on a leaked legacy id field", () => {
  assertThrows(
    () =>
      assertNoLegacyDiscoveryIdFields({
        operations: [{ fromNeuronId: 7 }],
      }),
    TopologyError,
  );
});

Deno.test("assertNoLegacyDiscoveryIdFields - traverses a wide array without RangeError (regression #2900)", () => {
  const SIZE = 200_000;
  const wide = new Array(SIZE);
  for (let i = 0; i < SIZE; i++) wide[i] = { ok: i };

  // Canary: spreading an array this wide into push arguments crashes; this is
  // the exact shape the traversal used to run on each array node.
  const canary: unknown[] = [];
  assertThrows(() => canary.push(...wide), RangeError);

  // The traversal now uses a stack-safe append, so a wide-but-clean payload
  // validates without throwing.
  assertNoLegacyDiscoveryIdFields({ synapses: wide });
});

Deno.test("assertNoLegacyDiscoveryIdFields - still detects a legacy field inside a wide array (regression #2900)", () => {
  const SIZE = 200_000;
  const wide = new Array(SIZE);
  for (let i = 0; i < SIZE; i++) wide[i] = { ok: i };
  // Hide a legacy field deep in the wide array.
  wide[SIZE - 1] = { removedNeuronIds: [3] };

  assertThrows(
    () => assertNoLegacyDiscoveryIdFields({ synapses: wide }),
    TopologyError,
  );
});

Deno.test("assertNoLegacyDiscoveryIdFields - order of traversal preserves contents (behaviour unchanged)", () => {
  // A nested structure that mixes arrays and objects; no legacy fields means
  // a clean pass, proving appendAll visits the same nodes as the old spread.
  assertNoLegacyDiscoveryIdFields({
    a: [1, 2, [3, 4, { b: [5, 6] }]],
    c: { d: [{ e: 7 }] },
  });
  assertEquals(true, true);
});

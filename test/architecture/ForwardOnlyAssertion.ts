/**
 * Tests for assertNoRecurrentSynapseOnForwardOnly (Issue #2500).
 *
 * The assertion is intended to be called at the corruption introduction
 * point (mutation, breeding, discovery, coordinated structural
 * application) so a forward-only creature that gains a recurrent synapse
 * fails fast with a useful stack trace, instead of being silently
 * stripped by `loadFrom`.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { Synapse } from "@architecture/Synapse.ts";
import { assertNoRecurrentSynapseOnForwardOnly } from "@architecture/ForwardOnlyAssertion.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("assertNoRecurrentSynapseOnForwardOnly: no-op when forwardOnly false", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { feedbackEnabled: true });
  c.forwardOnly = false;
  // Should not throw even with no synapses or with mixed shapes.
  assertNoRecurrentSynapseOnForwardOnly(c, "unit-test");
});

Deno.test("assertNoRecurrentSynapseOnForwardOnly: passes for valid forward-only creature", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.forwardOnly = true;
  // The default constructor gives a valid forward-only topology.
  assertNoRecurrentSynapseOnForwardOnly(c, "unit-test");
});

Deno.test("assertNoRecurrentSynapseOnForwardOnly: throws on self-loop", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.forwardOnly = true;
  // Inject a forbidden self-loop on the output neuron.
  const outIdx = c.neurons.length - 1;
  c.synapses.push(new Synapse(outIdx, outIdx, 0.1));

  const err = assertThrows(
    () => assertNoRecurrentSynapseOnForwardOnly(c, "mutation:test"),
    TopologyError,
  );
  // Confirm useful diagnostics.
  const msg = String((err as Error).message);
  assertEquals(msg.includes("mutation:test"), true);
  assertEquals(msg.includes("recurrent synapse"), true);
});

Deno.test("assertNoRecurrentSynapseOnForwardOnly: throws on backward edge", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.forwardOnly = true;
  const outIdx = c.neurons.length - 1;
  const hiddenIdx = outIdx - 1;
  // Backward edge output -> hidden (from > to).
  c.synapses.push(new Synapse(outIdx, hiddenIdx, 0.1));

  assertThrows(
    () => assertNoRecurrentSynapseOnForwardOnly(c, "breed:test"),
    TopologyError,
    "breed:test",
  );
});

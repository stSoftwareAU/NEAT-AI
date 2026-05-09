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
import {
  assertNoRecurrentSynapseOnForwardOnly,
  assertNoWireSelfLoopOnForwardOnly,
} from "@architecture/ForwardOnlyAssertion.ts";
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

// Issue #2618: wire-format UUID collision detection.
Deno.test("assertNoWireSelfLoopOnForwardOnly: no-op when forwardOnly false", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { feedbackEnabled: true });
  c.forwardOnly = false;
  assertNoWireSelfLoopOnForwardOnly(c, "unit-test");
});

Deno.test("assertNoWireSelfLoopOnForwardOnly: passes for distinct wire uuids", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.forwardOnly = true;
  // Default constructor produces neurons with distinct wire uuids.
  assertNoWireSelfLoopOnForwardOnly(c, "unit-test");
});

Deno.test("assertNoWireSelfLoopOnForwardOnly: throws when two neurons share a wire uuid (Issue #2618)", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.forwardOnly = true;
  // Force a collision: a hidden neuron whose stored uuid matches the
  // canonical wire label of the output. Synapse from hidden -> output
  // exports as `output-0 -> output-0`.
  const hidden = c.neurons.find((n) => n.type === "hidden");
  if (!hidden) throw new Error("expected hidden neuron in fixture");
  hidden.uuid = "output-0";
  c.synapses.push(new Synapse(hidden.index, c.neurons.length - 1, 0.1));

  const err = assertThrows(
    () => assertNoWireSelfLoopOnForwardOnly(c, "CRISPR.cleaveDNA"),
    TopologyError,
  );
  const msg = String((err as Error).message);
  assertEquals(msg.includes("CRISPR.cleaveDNA"), true);
  assertEquals(msg.includes("wire-format self-loop"), true);
  assertEquals(msg.includes("output-0"), true);
});

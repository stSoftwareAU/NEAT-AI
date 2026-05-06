/**
 * Tests for the forward-only post-condition on `exportJSONWithRuntimeIds`
 * (Issue #2546).
 *
 * Production GRQ logs (per Issue #2546) showed `[loadFrom] Recurrent
 * synapse … source=fromJSON` throws on every load even after Issue #2515
 * wired the `assertNoRecurrentSynapseOnForwardOnly` post-condition into
 * the discovery combiners and the public `exportJSON` save path. The
 * audit missed `exportJSONWithRuntimeIds`: it is the internal export
 * that worker training, scheduling, knowledge-distillation, replay, and
 * compaction route through and was therefore the only remaining
 * producer that could persist a forward-only creature with a recurrent
 * synapse to disk.
 *
 * These tests pin the new post-condition: a forward-only creature with
 * `from >= to` synapses must throw a `TopologyError` named
 * `exportJSONWithRuntimeIds` rather than letting the corruption escape
 * and trip the load-side throw on the next worker that ingests the
 * resulting JSON.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { Synapse } from "@architecture/Synapse.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("exportJSONWithRuntimeIds: passes for valid forward-only creature", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.forwardOnly = true;
  const json = exportJSONWithRuntimeIds(c);
  // Sanity check: still a valid round-trip (every synapse has from < to
  // when resolved against the wire neuron order).
  assertEquals(json.forwardOnly, true);
  assertEquals(json.synapses.length > 0, true);
});

Deno.test("exportJSONWithRuntimeIds: passes when forwardOnly is false even with recurrent edges", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { feedbackEnabled: true });
  c.forwardOnly = false;
  // Inject a self-loop. Should not throw because forwardOnly is not
  // enforced on this creature.
  const outIdx = c.neurons.length - 1;
  c.synapses.push(new Synapse(outIdx, outIdx, 0.1));
  // Should not throw — the post-condition only fires on forwardOnly
  // creatures.
  exportJSONWithRuntimeIds(c);
});

Deno.test("exportJSONWithRuntimeIds: throws TopologyError on self-loop on output-0 (Issue #2546)", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.forwardOnly = true;
  // GRQ-3 production signature: synapse=2057->2057 fromUUID=output-0
  // toUUID=output-0 depth=0 (self-loop on output-0).
  const outIdx = c.neurons.length - 1;
  c.synapses.push(new Synapse(outIdx, outIdx, 0.1));

  const err = assertThrows(
    () => exportJSONWithRuntimeIds(c),
    TopologyError,
  );
  const msg = String((err as Error).message);
  // Confirm the producer is named so the offending stack frame is
  // identifiable from the production log line alone.
  assertEquals(msg.includes("exportJSONWithRuntimeIds"), true);
  assertEquals(msg.includes("recurrent synapse"), true);
});

Deno.test("exportJSONWithRuntimeIds: throws TopologyError on backward output→hidden edge (Issue #2546)", async () => {
  await initWasmForTests();
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.forwardOnly = true;
  // GRQ-3 production signature: synapse=4145->4143 fromUUID=output-0
  // depth=-2 (backward edge from output back into hidden).
  const outIdx = c.neurons.length - 1;
  const hiddenIdx = outIdx - 1;
  c.synapses.push(new Synapse(outIdx, hiddenIdx, 0.1));

  assertThrows(
    () => exportJSONWithRuntimeIds(c),
    TopologyError,
    "exportJSONWithRuntimeIds",
  );
});

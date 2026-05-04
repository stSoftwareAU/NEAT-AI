/**
 * Issue #2511: forward-only creatures must round-trip cleanly through
 * toJSON/fromJSON without re-introducing recurrent synapses on the
 * single output neuron (`output-0`).
 *
 * Production logs (GRQ-10) showed 28 occurrences of
 *   `🚨 [loadFrom] Stripping recurrent synapse <id>->...
 *    (fromUUID=output-0, toUUID=output-0) from forward-only creature`
 * after a save/load round-trip, even though the creatures are flagged
 * forward-only and the only-output index is `output-0`. The strip is the
 * last line of defence — if it ever became a warn or info, the
 * corruption would silently propagate into trained models.
 *
 * This suite covers the issue's four asks:
 *
 *  1. `exportJSON` (save-side) refuses to serialise a forward-only
 *     creature that carries a recurrent synapse and throws a
 *     {@link TopologyError} naming the offending edge so the producing
 *     pipeline's stack frame is captured.
 *  2. `loadFrom` strip warning includes a `depth=<to-from>` token so
 *     self-loops (depth=0) and cross-loops (depth<0) are
 *     distinguishable at a glance.
 *  3. The audited mutation operators (`AddSelfCon`, `AddConnection`,
 *     `AddNeuron`) do not produce a self-loop on `output-0` after many
 *     repetitions on a forward-only creature.
 *  4. A clean forward-only creature with `output-0` as the only output
 *     round-trips through `toJSON`/`fromJSON` with no recurrent synapse
 *     in the parsed output.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { Synapse } from "@architecture/Synapse.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { Mutation } from "@neat/Mutation.ts";
import { Mutator } from "@neat/Mutator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { getLogger } from "@utils/Logger.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = false;

function newForwardOnlyWithSingleOutput(): Creature {
  const c = new Creature(2, 1, { layers: [{ count: 2 }] });
  c.forwardOnly = true;
  return c;
}

Deno.test("Issue #2511: forward-only creature with output-0 round-trips with no recurrent synapse", async () => {
  await initWasmForTests();

  const original = newForwardOnlyWithSingleOutput();
  // Sanity: the only output index should map to output-0.
  assertEquals(original.output, 1);
  for (const s of original.synapses) {
    assert(
      s.from < s.to,
      `forward-only creature must not start with recurrent synapses: ${s.from}->${s.to}`,
    );
  }

  const json = original.exportJSON();

  // Capture loadFrom logs to confirm no strip warnings fire on a clean
  // round-trip.
  const logger = getLogger();
  const captured: string[] = [];
  const originalError = logger.error.bind(logger);
  logger.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  let restored: Creature;
  try {
    restored = Creature.fromJSON(json);
  } finally {
    logger.error = originalError;
  }

  for (const s of restored.synapses) {
    assert(
      s.from < s.to,
      `Issue #2511: round-trip must not introduce recurrent synapses; got ${s.from}->${s.to}`,
    );
  }
  assertEquals(restored.forwardOnly, true);

  const stripWarnings = captured.filter((m) =>
    m.includes("Stripping recurrent synapse")
  );
  assertEquals(
    stripWarnings.length,
    0,
    `Issue #2511: clean round-trip must not log strip warnings; got ${stripWarnings.length}: ${
      stripWarnings.join("; ")
    }`,
  );
});

Deno.test("Issue #2511: exportJSON refuses to serialise forward-only creature with recurrent synapse", async () => {
  await initWasmForTests();

  const c = newForwardOnlyWithSingleOutput();
  // Inject the exact corruption pattern observed in production
  // (output-0 self-loop) without going through any mutation operator.
  const outputIdx = c.neurons.length - 1;
  c.synapses.push(new Synapse(outputIdx, outputIdx, 0.1));

  const err = assertThrows(
    () => c.exportJSON(),
    TopologyError,
  );
  const msg = (err as Error).message;
  assert(
    msg.includes("exportJSON"),
    `error must name the save-side caller (source=exportJSON); got: ${msg}`,
  );
  assert(
    msg.includes(`${outputIdx}->${outputIdx}`),
    `error must name the offending synapse indices ${outputIdx}->${outputIdx}; got: ${msg}`,
  );
});

Deno.test("Issue #2511: exportJSON allows recurrent synapse on non-forward-only creature", async () => {
  await initWasmForTests();

  const c = new Creature(2, 1, { feedbackEnabled: true });
  c.forwardOnly = false;
  const outputIdx = c.neurons.length - 1;
  c.synapses.push(new Synapse(outputIdx, outputIdx, 0.1));

  // Must not throw — recurrent synapses are valid on recurrent creatures.
  const json = c.exportJSON();
  assert(json.synapses.length > 0);
});

Deno.test("Issue #2511: loadFrom strip warning includes depth=<to-from>", async () => {
  await initWasmForTests();

  // Forward-only export JSON with one self-loop (depth=0) and one
  // cross-loop (depth<0) so we can exercise both labels.
  const json: CreatureExport = {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h-1", squash: IDENTITY.NAME, bias: 0 },
      { type: "output", uuid: "o-0", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-1", weight: 0.1 },
      { fromUUID: "h-1", toUUID: "o-0", weight: 0.2 },
      // Self-loop on output: depth = 0
      { fromUUID: "o-0", toUUID: "o-0", weight: 0.3 },
      // Cross-loop output -> hidden: depth < 0
      { fromUUID: "o-0", toUUID: "h-1", weight: 0.4 },
    ],
  } as unknown as CreatureExport;

  const logger = getLogger();
  const captured: string[] = [];
  const originalError = logger.error.bind(logger);
  logger.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    // Issue #2514: the load-side throw is the new default. Opt back
    // into the legacy strip+warn path to keep exercising the depth
    // label assertions below (this test is specifically about the
    // warning emission, not about the throw default which has its
    // own coverage in `LoadFromForwardOnlyThrow.ts`).
    Creature.fromJSON(json, false, "fromJSON", { throwOnRecurrent: "never" });
  } finally {
    logger.error = originalError;
  }

  const stripWarnings = captured.filter((m) =>
    m.includes("Stripping recurrent synapse")
  );
  assertEquals(
    stripWarnings.length,
    2,
    `expected 2 strip warnings (1 self-loop + 1 cross-loop); got ${stripWarnings.length}`,
  );
  for (const w of stripWarnings) {
    assert(
      /depth=-?\d+/.test(w),
      `Issue #2511: warning must include depth=<to-from>; got: ${w}`,
    );
  }

  // Self-loop must be labelled depth=0; cross-loop output->hidden must
  // have a strictly negative depth so cross-loops stand out at a glance.
  const selfLoop = stripWarnings.find((w) => w.includes("toUUID=o-0"));
  assert(selfLoop, "expected a self-loop warning");
  assert(
    /depth=0/.test(selfLoop!),
    `self-loop must be depth=0; got: ${selfLoop}`,
  );

  const crossLoop = stripWarnings.find((w) => w.includes("toUUID=h-1"));
  assert(crossLoop, "expected a cross-loop warning");
  assert(
    /depth=-\d+/.test(crossLoop!),
    `cross-loop output->hidden must be depth<0; got: ${crossLoop}`,
  );
});

Deno.test("Issue #2511: audited mutation operators never produce output-0 self-loop on forward-only creature", async () => {
  await initWasmForTests();

  const ops = [
    Mutation.ADD_SELF_CONN,
    Mutation.ADD_BACK_CONN,
    Mutation.ADD_CONN,
    Mutation.ADD_NODE,
  ];
  const mutator = new Mutator(
    createNeatConfig({
      feedbackLoop: false,
      mutationRate: 1,
      mutationAmount: 1,
      mutation: Array.from(ops),
      log: 0,
    }),
  );

  // Many reps so RNG paths are exercised. Each iteration starts from a
  // fresh forward-only creature with `output-0` as its only output.
  for (let i = 0; i < 50; i++) {
    const c = newForwardOnlyWithSingleOutput();
    const op = ops[i % ops.length];
    mutator.mutateCreature(c, op);
    mutator.repairAfterMutation(c);

    for (const s of c.synapses) {
      assert(
        s.from < s.to,
        `Issue #2511: ${op.name} must not produce a recurrent synapse on forward-only creature: ${s.from}->${s.to} (iter=${i})`,
      );
    }
    // exportJSON now also enforces this — confirm the creature is
    // serialisable end-to-end.
    const json = c.exportJSON();
    assertEquals(json.forwardOnly, true);
  }
});

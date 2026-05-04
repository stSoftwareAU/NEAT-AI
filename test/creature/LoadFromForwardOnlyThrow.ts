/**
 * Issue #2514: promote `loadFrom`'s recurrent-synapse strip from a silent
 * warning to a `TopologyError` throw by default for forward-only
 * creatures. The strip used to self-heal the topology on every load,
 * which hid the producing pipeline's stack frame and made the upstream
 * corruption invisible. The new default surfaces the offending edge so
 * the producer can be fixed.
 *
 * This suite covers the three asks from the issue:
 *  1. Default behaviour throws on a forward-only creature with
 *     `output-0 -> output-0`.
 *  2. `throwOnRecurrent: "never"` preserves the legacy strip+warn
 *     behaviour for repair tools.
 *  3. The thrown `TopologyError` contains the offending synapse, depth,
 *     source tag, and a stack frame pointing at the call site.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { fromJSON, loadFrom } from "@creature/CreatureSerialization.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { getLogger } from "@utils/Logger.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = false;

/**
 * Build an export-shaped JSON for a forward-only creature with a
 * poisoned `output-0 -> output-0` recurrent self-loop. Mirrors the
 * production GRQ-3-rocket.log signature (depth=0, fromUUID=output-0).
 */
function makeForwardOnlyExportWithOutputSelfLoop(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      // hidden at index 2
      { type: "hidden", uuid: "h-1", squash: "IDENTITY", bias: 0 },
      // output at index 3 (id resolved at load time)
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-1", weight: 0.1 },
      { fromUUID: "h-1", toUUID: "output-0", weight: 0.2 },
      // The corrupt edge: forward-only creature with a self-loop on output-0.
      { fromUUID: "output-0", toUUID: "output-0", weight: 0.3 },
    ],
  } as unknown as CreatureExport;
}

/** Same shape, but a recurrent creature (no `forwardOnly` flag set) so
 *  recurrent synapses are legitimate. */
function makeRecurrentExport(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h-1", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "o-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-1", weight: 0.1 },
      { fromUUID: "h-1", toUUID: "o-0", weight: 0.2 },
      { fromUUID: "o-0", toUUID: "o-0", weight: 0.3 },
    ],
  } as unknown as CreatureExport;
}

Deno.test("Issue #2514: loadFrom default throws on forward-only output-0 self-loop", async () => {
  await initWasmForTests();

  const error = assertThrows(
    () => fromJSON(makeForwardOnlyExportWithOutputSelfLoop(), false, Creature),
    TopologyError,
  );

  assertEquals(
    error.reason,
    "INVALID_CONNECTION",
    "TopologyError must carry reason=INVALID_CONNECTION",
  );

  // The message names the offending edge endpoints (UUIDs) and depth=0.
  assert(
    /fromUUID=output-0/.test(error.message),
    `expected fromUUID=output-0 in message, got: ${error.message}`,
  );
  assert(
    /toUUID=output-0/.test(error.message),
    `expected toUUID=output-0 in message, got: ${error.message}`,
  );
  assert(
    /depth=0/.test(error.message),
    `expected depth=0 in message, got: ${error.message}`,
  );

  // The source tag identifies the calling pipeline so logs can attribute
  // the offending producer.
  assert(
    /source=fromJSON/.test(error.message),
    `expected source=fromJSON in message, got: ${error.message}`,
  );

  // The thrown error carries a stack frame pointing at the call site.
  assert(
    typeof error.stack === "string" && error.stack.length > 0,
    "TopologyError.stack must be present and non-empty",
  );
});

Deno.test("Issue #2514: throwOnRecurrent=never preserves legacy strip+warn", async () => {
  await initWasmForTests();

  const logger = getLogger();
  const original = logger.error.bind(logger);
  const captured: string[] = [];
  logger.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };

  let creature: Creature | undefined;
  try {
    creature = fromJSON(
      makeForwardOnlyExportWithOutputSelfLoop(),
      false,
      Creature,
      "fromJSON",
      { throwOnRecurrent: "never" },
    );
  } finally {
    logger.error = original;
  }

  assert(
    creature,
    "fromJSON with throwOnRecurrent=never must produce a creature",
  );

  // The legacy warning is still emitted on the error logger.
  const stripWarnings = captured.filter((m) =>
    m.includes("Stripping recurrent synapse")
  );
  assert(
    stripWarnings.length > 0,
    `expected at least one strip warning, got: ${captured.join("\n")}`,
  );

  // No recurrent edge survives the load — the strip path is what kept
  // the runtime topology valid.
  for (const synapse of creature.synapses) {
    assert(
      synapse.from < synapse.to,
      `expected from<to in forward-only creature, got ${synapse.from}->${synapse.to}`,
    );
  }
});

Deno.test("Issue #2514: throwOnRecurrent=always throws on recurrent (non-forward-only) creature", async () => {
  await initWasmForTests();

  // Recurrent creature loads fine by default — the gate only fires for
  // forward-only — but `always` opts into stricter checks regardless.
  // Sanity-check the default behaviour first.
  const ok = fromJSON(makeRecurrentExport(), false, Creature);
  assert(ok, "recurrent creature must load by default");
  assert(
    ok.synapses.some((s) => s.from >= s.to),
    "recurrent creature must keep its self-loop under the default gate",
  );

  // Now opt into `always` and verify it throws.
  assertThrows(
    () =>
      fromJSON(makeRecurrentExport(), false, Creature, "fromJSON", {
        throwOnRecurrent: "always",
      }),
    TopologyError,
  );
});

Deno.test("Issue #2514: loadFrom throws synchronously and the error tags the source pipeline", async () => {
  await initWasmForTests();

  const target = new Creature(2, 1, { feedbackEnabled: false });
  target.forwardOnly = true;

  const error = assertThrows(
    () =>
      loadFrom(
        target,
        makeForwardOnlyExportWithOutputSelfLoop(),
        false,
        "unit-test:throw-source",
      ),
    TopologyError,
  );

  assert(
    /source=unit-test:throw-source/.test(error.message),
    `expected source tag in TopologyError message, got: ${error.message}`,
  );
  // The thrown error includes the structural-hash fallback identifier,
  // because the source JSON omits a creature uuid.
  assert(
    /UUID:\s*hash:[0-9a-f]{8}/i.test(error.message),
    `expected hash:<8hex> uuid label in TopologyError message, got: ${error.message}`,
  );
});

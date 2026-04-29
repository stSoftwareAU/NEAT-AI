/**
 * Issue #2484 — Permanent end-to-end regression test for the
 * `WasmCreatureActivation.create` `RuntimeError: unreachable` trap.
 *
 * Companion to:
 *
 *   - #2482 (`WasmCreatureActivationCreateTrapGuard.ts`) — diagnostic test
 *     that drives the trap directly through the WASM constructor with a
 *     hand-built binary.
 *   - #2483 (`WasmCompileFailureRecovery.ts`) — unit-level recovery test
 *     for `WasmCreatureActivation.create` returning `null` and the typed
 *     `WasmError` surfaced by `activateWasm` / `activateAndTraceWasm`.
 *
 * What this test adds: drives `Creature.activateAndTrace` end-to-end
 * through the public API on a small (2 input → 2 hidden → 1 output)
 * pathological creature, plus a tight loop directly through
 * `WasmCreatureActivation.create` with the production failure-shape
 * binary captured in #2482, and confirms three things at once:
 *
 *   1. No `RuntimeError` propagates to the caller — the trap is converted
 *      to a typed `WasmError` (`reason="ACTIVATION_FAILED"`) so the
 *      surrounding training loop can drop the creature gracefully.
 *   2. `WasmCreatureActivation.create` returns `null` (never throws) and
 *      emits **zero** log lines from the create path itself — the
 *      production 40-line `RuntimeError: unreachable` spam is not
 *      reintroduced. (Dedup logging at the
 *      `WasmCompilationCacheImpl.getOrCompile` boundary is covered by
 *      #2483; here we guard the lower-level surface.)
 *   3. After the trap path runs, a brand-new healthy creature still
 *      compiles and activates normally — proving the failure does not
 *      poison the WASM module, the compilation cache, or the LRU.
 *
 * Pathological state:
 *
 *   The end-to-end test (Test 1) drives a creature whose hidden synapses
 *   point past the neuron array (`from = 65000`). The buffer compiles
 *   cleanly but the WASM kernel traps on first activation when it tries
 *   to read past the activation array — an out-of-bounds shape that, like
 *   the production header-invariant trap, surfaces as
 *   `RuntimeError: unreachable` from a deep WASM frame. The post-#2483
 *   recovery wrapping must convert that into a typed `WasmError` before
 *   it leaves `Creature.activateAndTrace`.
 *
 *   The compile-time test (Test 2) feeds the exact production failure
 *   shape — `num_inputs > num_neurons` header invariant from #2482 —
 *   directly to `WasmCreatureActivation.create` ten times in a row. The
 *   reason for going below the cache here: the cache's `buildTemplate`
 *   path JS-side throws a `RangeError` before reaching the WASM
 *   constructor when `creature.input > creature.neurons.length`, so the
 *   only way to drive the WASM constructor with that binary is to bypass
 *   `buildTemplate`. This mirrors how the trap actually fired in
 *   production: `WasmCompilationCache.buildTemplate` produced a binary
 *   whose header invariant was violated, and `WasmCreatureActivation.create`
 *   then took it.
 *
 *   Note: while the issue text suggests `Infinity` bias / weight as the
 *   failure shape, the #2482 diagnosis confirmed those values do **not**
 *   trap (non-finite weights are blocked at the `Synapse` constructor;
 *   non-finite biases compile cleanly via `f32.demote_f64`). The two
 *   shapes used here — header-invariant binary and out-of-bounds synapse
 *   `from` — are the real production triggers and what we guard against.
 *
 * The test is hermetic and deterministic — fixed creature shape, fixed
 * inputs, no RNG — and completes well under the 5-second budget.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { WasmError } from "@errors/WasmError.ts";
import {
  ensureWasmActivation,
  isWasmActivationAvailable,
  resetFailedCompileDedup,
  resetLastWasmCreateFailure,
  WasmCreatureActivation,
} from "@wasm/mod.ts";
import type { SparseConfigLike } from "@propagate/sparse/SparseConfigLike.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

interface LogCall {
  level: "debug" | "info" | "warn" | "error";
  args: unknown[];
}

function captureLogger(): { logger: Logger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const logger: Logger = {
    debug: (...args) => calls.push({ level: "debug", args }),
    info: (...args) => calls.push({ level: "info", args }),
    warn: (...args) => calls.push({ level: "warn", args }),
    error: (...args) => calls.push({ level: "error", args }),
  };
  return { logger, calls };
}

/**
 * Trace-everything stub — kept tiny to avoid pulling extra modules into the
 * regression test, and to bypass `SparseConfig`'s structural inspection of
 * the creature export which would itself reject a deliberately corrupt
 * creature before the trap could fire.
 */
const TRACE_ALL_SPARSE: SparseConfigLike = {
  traceNeeded: () => true,
  propagateNeeded: () => true,
  updateNeeded: () => true,
};

/**
 * Build a healthy 2 → 2 → 1 creature via the public API. The shape is
 * requested explicitly by the issue ("a small creature, e.g., 2 inputs →
 * 2 hidden → 1 output"); we use the public constructor rather than
 * hand-built JSON so the test exercises the same compilation path as
 * production.
 */
function buildHealthy221(uuid: string): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2 }],
  });
  creature.fix();
  creature.clearState();
  creature.uuid = uuid;
  // Ensure topology hash is computed before the test runs so the cache key
  // matches what production sees.
  CreatureUtil.getTopologyHash(creature);
  return creature;
}

/**
 * Corrupt a healthy creature so that the WASM kernel traps on first
 * activation. We point the hidden synapses past the activation array
 * (`from = 65000`); the binary compiles cleanly but the kernel traps with
 * `RuntimeError: unreachable` when it tries to read input[65000]. The
 * post-#2483 recovery wrapping in `activateAndTraceWasm` must convert this
 * into a typed `WasmError` before it leaves `Creature.activateAndTrace`.
 */
function corruptHiddenSynapsesFrom(creature: Creature): void {
  for (const synapse of creature.synapses) {
    if (synapse.to >= creature.input) {
      synapse.from = 65000;
    }
  }
  creature.clearCache();
  if (creature.cachedWasmActivation) {
    creature.cachedWasmActivation.free();
    creature.cachedWasmActivation = undefined;
  }
}

/**
 * Build the exact production failure-shape binary captured in #2482:
 * `num_inputs > num_neurons` in the WASM header. Triggers
 * `RuntimeError: unreachable` inside `compilednetwork_new` when the
 * unsigned `num_neurons - num_inputs` subtraction wraps and the
 * subsequent allocation traps.
 */
function buildHeaderInvariantBinary(): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 1, true); // num_neurons
  view.setUint32(4, 2, true); // num_inputs (exceeds num_neurons by 1)
  return buf;
}

Deno.test(
  "Issue #2484: Creature.activateAndTrace surfaces WASM trap as WasmError, not RuntimeError",
  async () => {
    await ensureWasmActivation();
    assert(isWasmActivationAvailable(), "WASM must be available for this test");

    resetFailedCompileDedup();
    resetLastWasmCreateFailure();

    const creature = buildHealthy221(
      "00000000-0000-4000-8000-000000002484-bad",
    );
    corruptHiddenSynapsesFrom(creature);

    const input = new Float32Array([0.25, -0.75]);

    // The trap surfaces as a typed WasmError — never a raw WebAssembly
    // RuntimeError. This is the contract that lets the training loop drop
    // the creature gracefully instead of crashing the worker.
    const err = assertThrows(
      () => creature.activateAndTrace(input, false, TRACE_ALL_SPARSE),
      WasmError,
    );
    assertEquals(
      (err as WasmError).reason,
      "ACTIVATION_FAILED",
      "WASM trap must surface as ACTIVATION_FAILED",
    );
    assert(
      err.constructor.name !== "RuntimeError",
      "RuntimeError must NOT propagate to the caller of activateAndTrace",
    );
  },
);

Deno.test(
  "Issue #2484: WasmCreatureActivation.create returns null silently for the production trap shape (no log spam)",
  async () => {
    await ensureWasmActivation();
    assert(isWasmActivationAvailable(), "WASM must be available for this test");

    resetFailedCompileDedup();
    resetLastWasmCreateFailure();

    // Capture the global logger. Pre-#2483 the create path emitted one
    // `Failed to create WASM activation: RuntimeError: unreachable` line
    // per call, producing the 40-line spam observed on GRQ-16. The
    // post-#2483 contract is: zero logs at the create surface, with the
    // dedup log emitted exactly once by the cache wrapper (covered by
    // #2483's `WasmCompileFailureRecovery.ts`).
    const { logger, calls } = captureLogger();
    const previous = getLogger();
    setLogger(logger);
    try {
      const compiled = {
        data: buildHeaderInvariantBinary(),
        numNeurons: 1,
        numInputs: 2,
        numOutputs: 0,
        numSynapses: 0,
      };

      // Drive the trap shape 10× — production saw 40 trap lines because
      // every call leaked. With #2483 in place we should see exactly zero
      // logs from the create surface itself, even across repeated retries.
      for (let attempt = 0; attempt < 10; attempt++) {
        const wasm = WasmCreatureActivation.create(compiled);
        assertEquals(
          wasm,
          null,
          `attempt ${attempt}: create() must surface trap as null (not throw)`,
        );
      }

      const trapWarns = calls.filter((c) =>
        (c.level === "warn" || c.level === "error") &&
        c.args.some((a) =>
          typeof a === "string" &&
          (a.includes("RuntimeError") || a.includes("unreachable") ||
            a.includes("Failed to create WASM activation"))
        )
      );
      assertEquals(
        trapWarns.length,
        0,
        `create surface must not log on trap (dedup happens at the cache layer); got ${
          JSON.stringify(calls)
        }`,
      );
    } finally {
      setLogger(previous);
    }
  },
);

Deno.test(
  "Issue #2484: a healthy creature still compiles and activates after a bad one trapped",
  async () => {
    await ensureWasmActivation();
    assert(isWasmActivationAvailable(), "WASM must be available for this test");

    resetFailedCompileDedup();
    resetLastWasmCreateFailure();

    // First, drive the bad creature once so the failure path runs — this
    // primes the same conditions a training loop would see in production.
    const bad = buildHealthy221(
      "00000000-0000-4000-8000-000000002484-priming",
    );
    corruptHiddenSynapsesFrom(bad);
    try {
      bad.activateAndTrace(
        new Float32Array([0.0, 0.0]),
        false,
        TRACE_ALL_SPARSE,
      );
      throw new Error("bad creature should have trapped");
    } catch (e) {
      assert(
        e instanceof WasmError,
        `bad creature must surface WasmError, got ${
          (e as Error).constructor.name
        }: ${(e as Error).message}`,
      );
    }

    // Now a brand-new healthy creature must compile and activate cleanly.
    // This is the criterion that distinguishes a graceful drop from a
    // poisoned cache / module.
    const healthy = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });
    healthy.fix();
    healthy.clearState();
    CreatureUtil.makeUUID(healthy);

    const output = healthy.activateAndTrace(
      new Float32Array([0.5, -0.25]),
      false,
      TRACE_ALL_SPARSE,
    );

    assertEquals(
      output.length,
      1,
      "healthy creature should produce one output",
    );
    assert(
      Number.isFinite(output[0]),
      `healthy creature output must be finite, got ${output[0]}`,
    );
  },
);

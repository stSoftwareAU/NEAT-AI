/**
 * Issue #2658 — Activation-path WASM trap guard.
 *
 * Background:
 *
 *   Issue #2648/#2650 wrapped the WASM **topology** entry points
 *   (`validateTopology`, `validateStructuralIntegrity`, ...) in
 *   `withWasmTrapGuard`, so a malformed creature surfaces as a typed
 *   `TopologyError` during breeding instead of crashing `evolveRL` with a
 *   raw `RuntimeError: memory access out of bounds`.
 *
 *   Issue #2658 audits the remaining WASM entry points reached from
 *   `evolveRL` — specifically the **activation** path
 *   (`WasmCreatureActivation.activate`, `activate_view`, `activate_into`,
 *   `activate_and_trace`, the standalone batch loss kernels). Those calls
 *   sit behind `invalidateAfterWasmPanic`, which currently re-throws the
 *   raw `RuntimeError` verbatim. Production logs from the lunar-lander
 *   overnight driver still see `RuntimeError: memory access out of bounds`
 *   surface from inside an `evolveRL` run, terminating the run before the
 *   next generation can be scored.
 *
 *   These tests pin the contract: every `WasmCreatureActivation.activate*`
 *   call MUST surface a WASM trap as a typed `WasmError` with reason
 *   `ACTIVATION_FAILED` so the surrounding training loop can drop the
 *   creature instead of crashing the whole run. The same guarantee must
 *   hold for the higher-level `activateEphemeral` wrapper, because it
 *   bypasses the `activateWasm` try/catch (Issue #2146) by talking to
 *   `WasmCreatureActivation` directly.
 *
 *   The trap is reproduced by feeding `WasmCreatureActivation` a creature
 *   whose synapses point at a non-existent `from` neuron index — the
 *   binary compiles cleanly but the WASM activation kernel traps the
 *   moment it tries to read past the activation array. This is the same
 *   technique `WasmCompileFailureRecovery.ts` (Issue #2483) uses to drive
 *   `activateWasm` into its existing recovery path; here we drive the
 *   raw `WasmCreatureActivation` API directly to prove the guard sits at
 *   the right layer.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { WasmError } from "@errors/WasmError.ts";
import { activateEphemeral } from "@creature/CreatureActivation.ts";
import { WasmCreatureActivation } from "@wasm/WasmActivation.ts";
import { compileCreatureToWasm } from "@wasm/CompileToWasm.ts";
import { initWasmActivation } from "@wasm/WasmModuleLoader.ts";

await initWasmActivation();

/**
 * Build a 2-input / 1-output creature whose synapses all point at neuron
 * index 9999. Compilation succeeds (the binary is structurally well-formed
 * — the indices fit in a `u16`) but every activation traps in the WASM
 * kernel when it tries to read past the activation array.
 */
function createTrappingCreature(): Creature {
  const creature = new Creature(2, 1);
  creature.fix();
  for (const synapse of creature.synapses) {
    synapse.from = 9999;
  }
  creature.clearCache();
  creature.cachedWasmActivation = undefined;
  return creature;
}

function createTrappingActivation(): WasmCreatureActivation {
  const creature = createTrappingCreature();
  const compiled = compileCreatureToWasm(creature);
  const activation = WasmCreatureActivation.create(compiled);
  if (!activation) {
    throw new Error(
      "Test setup: trapping creature should still compile cleanly; " +
        "the activation kernel — not the constructor — is the trap site.",
    );
  }
  return activation;
}

// ---------------------------------------------------------------------------
// WasmCreatureActivation direct API — the lowest WASM-bridge layer.
// ---------------------------------------------------------------------------

Deno.test(
  "Issue #2658: activate() surfaces WASM trap as typed WasmError",
  () => {
    const activation = createTrappingActivation();
    const err = assertThrows(
      () => activation.activate(new Float32Array([0.1, 0.2])),
      WasmError,
      undefined,
      "WasmCreatureActivation.activate must convert WASM trap to WasmError, " +
        "not propagate the raw RuntimeError",
    );
    assertEquals((err as WasmError).reason, "ACTIVATION_FAILED");
  },
);

Deno.test(
  "Issue #2658: activateView() surfaces WASM trap as typed WasmError",
  () => {
    const activation = createTrappingActivation();
    const err = assertThrows(
      () => activation.activateView(new Float32Array([0.1, 0.2])),
      WasmError,
    );
    assertEquals((err as WasmError).reason, "ACTIVATION_FAILED");
  },
);

Deno.test(
  "Issue #2658: activateInto() surfaces WASM trap as typed WasmError",
  () => {
    const activation = createTrappingActivation();
    const err = assertThrows(
      () =>
        activation.activateInto(
          new Float32Array([0.1, 0.2]),
          new Float32Array(1),
        ),
      WasmError,
    );
    assertEquals((err as WasmError).reason, "ACTIVATION_FAILED");
  },
);

Deno.test(
  "Issue #2658: activateWithState() surfaces WASM trap as typed WasmError",
  () => {
    const activation = createTrappingActivation();
    const err = assertThrows(
      () => activation.activateWithState(new Float32Array([0.1, 0.2]), false),
      WasmError,
    );
    assertEquals((err as WasmError).reason, "ACTIVATION_FAILED");
  },
);

Deno.test(
  "Issue #2658: activateAndTrace() surfaces WASM trap as typed WasmError",
  () => {
    const activation = createTrappingActivation();
    const err = assertThrows(
      () => activation.activateAndTrace(new Float32Array([0.1, 0.2])),
      WasmError,
    );
    assertEquals((err as WasmError).reason, "ACTIVATION_FAILED");
  },
);

Deno.test(
  "Issue #2658: wrapped WasmError preserves the original trap via Error.cause",
  () => {
    const activation = createTrappingActivation();
    let caught: unknown;
    try {
      activation.activate(new Float32Array([0.1, 0.2]));
    } catch (e) {
      caught = e;
    }
    if (!(caught instanceof WasmError)) {
      throw new Error("expected WasmError");
    }
    // The cause is the original RuntimeError trap; the message preserves
    // the trap text so diagnostics remain observable.
    if (caught.cause === undefined) {
      throw new Error(
        "WasmError must attach the original trap as .cause so diagnostics " +
          "can inspect the underlying RuntimeError",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Pre-existing WasmError surfaces (input length, freed) keep propagating
// untouched — we are only converting raw RuntimeError traps.
// ---------------------------------------------------------------------------

Deno.test(
  "Issue #2658: input-length WasmError still propagates with original reason",
  () => {
    const activation = createTrappingActivation();
    try {
      // Wrong input length — pre-flight check throws WasmError before the
      // WASM call. The trap guard must not stomp on the message.
      const err = assertThrows(
        () => activation.activate(new Float32Array([0.5])),
        WasmError,
      );
      // The pre-flight error message describes the length mismatch.
      // It must not be replaced with a generic "WASM activation failed" wrap.
      if (!(err as WasmError).message.includes("Input length")) {
        throw new Error(
          `expected pre-flight length message, got: ${
            (err as WasmError).message
          }`,
        );
      }
    } finally {
      activation.free();
    }
  },
);

// ---------------------------------------------------------------------------
// activateEphemeral — the CreatureActivation.ts wrapper that previously
// did NOT wrap the underlying activate call (only activateWasm did).
// With the trap guard pushed down into WasmCreatureActivation, ephemeral
// activation now also drops the offending creature cleanly.
// ---------------------------------------------------------------------------

Deno.test(
  "Issue #2658: activateEphemeral surfaces WASM trap as typed WasmError",
  () => {
    const creature = createTrappingCreature();
    const err = assertThrows(
      () => activateEphemeral(creature, new Float32Array([0.1, 0.2]), false),
      WasmError,
    );
    assertEquals(
      (err as WasmError).reason,
      "ACTIVATION_FAILED",
      "activateEphemeral must drop the creature via WasmError, " +
        "not crash the surrounding evolveRL run with a raw RuntimeError",
    );
  },
);

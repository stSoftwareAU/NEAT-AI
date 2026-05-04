/**
 * Issue #2146 - WASM activateAndTrace was selected but failed to instantiate CompiledNetwork
 *
 * When WASM compilation fails (e.g., RuntimeError: unreachable from corrupted
 * or edge-case creature topologies), the activation functions must throw a
 * typed WasmError — not an AssertionError from fail(). AssertionError crashes
 * the worker process unrecoverably; WasmError allows callers to handle the
 * failure gracefully.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { exportJSONUnchecked } from "@creature/CreatureSerialization.ts";
import { WasmError } from "@errors/WasmError.ts";
import {
  activateAndTraceWasm,
  activateWasm,
} from "@creature/CreatureActivation.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { initWasmActivation } from "@wasm/WasmModuleLoader.ts";

await initWasmActivation();

/**
 * Create a creature with a corrupted topology that causes WASM instantiation
 * to fail with RuntimeError: unreachable. This reproduces the issue from #2146
 * where certain creature topologies produce WASM binary data that traps at
 * runtime.
 */
function createCorruptedCreature(): Creature {
  const creature = new Creature(2, 1);
  creature.fix();

  // Corrupt synapse from-indices to reference non-existent neurons.
  // The WASM binary will be structurally valid but will trap when
  // it tries to read activation values at out-of-bounds indices.
  for (const synapse of creature.synapses) {
    synapse.from = 9999;
  }

  // Clear all caches to force re-compilation with the corrupted topology.
  creature.clearCache();
  creature.cachedWasmActivation = undefined;

  return creature;
}

Deno.test(
  "Issue #2146: activateWasm throws WasmError not AssertionError on instantiation failure",
  () => {
    const creature = createCorruptedCreature();
    const input = new Float32Array([0.5, 0.3]);

    const err = assertThrows(
      () => activateWasm(creature, input, false),
      WasmError,
    );

    // The key assertion: the error is a WasmError with ACTIVATION_FAILED
    // reason, not an AssertionError from fail().
    assertEquals(
      (err as WasmError).reason,
      "ACTIVATION_FAILED",
      "Expected ACTIVATION_FAILED reason code",
    );
  },
);

Deno.test(
  "Issue #2146: activateAndTraceWasm throws WasmError not AssertionError on instantiation failure",
  () => {
    const creature = createCorruptedCreature();
    const input = new Float32Array([0.5, 0.3]);
    // Issue #2511: the test deliberately corrupts synapse.from so the
    // public exportJSON now refuses to serialise. This test cares about
    // WASM instantiation failure surfacing as WasmError, not the
    // save-side assertion — use the unchecked export so we still reach
    // the WASM path.
    const json = exportJSONUnchecked(creature);
    const bpConfig = createBackPropagationConfig({});
    const sparseConfig = new SparseConfig(json, bpConfig);

    const err = assertThrows(
      () => activateAndTraceWasm(creature, input, false, sparseConfig),
      WasmError,
    );

    assertEquals(
      (err as WasmError).reason,
      "ACTIVATION_FAILED",
      "Expected ACTIVATION_FAILED reason code",
    );
  },
);

/**
 * WASM Ownership Recovery Tests
 *
 * Issue #2207 - Verify that WASM activation handles ownership errors
 * gracefully. When a WASM function panics (RuntimeError: unreachable),
 * the Rust borrow counter may not be decremented, leaving the
 * CompiledNetwork in a permanently borrowed state. Subsequent calls to
 * free() must not propagate the ownership error — instead, the
 * activation should be invalidated and the JS reference released for GC.
 *
 * These tests verify both normal disposal behaviour and recovery from
 * real WASM traps that leave the borrow count dangling.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { WasmError } from "@errors/WasmError.ts";
import { WasmCreatureActivation } from "@wasm/WasmActivation.ts";
import { compileCreatureToWasm } from "@wasm/CompileToWasm.ts";
import {
  getMseSumBatchPackedFn,
  initWasmActivation,
} from "@wasm/WasmModuleLoader.ts";

await initWasmActivation();

function createTestCreature(): Creature {
  const creature = new Creature(2, 1);
  creature.fix();
  return creature;
}

function createActivation(): WasmCreatureActivation {
  const creature = createTestCreature();
  const compiled = compileCreatureToWasm(creature);
  const activation = WasmCreatureActivation.create(compiled);
  if (!activation) throw new Error("Failed to create WasmCreatureActivation");
  return activation;
}

/**
 * Triggers a WASM trap by calling the standalone mse_sum_batch_packed
 * function with num_outputs far exceeding the network's neuron count.
 *
 * The network has 3 neurons (2 input + 1 output). Passing num_outputs=100
 * causes a subtraction underflow in `activate_into` (self.num_neurons -
 * num_outputs), which panics in WASM. The wasm-bindgen internal borrow
 * count on the CompiledNetwork pointer is left incremented because the
 * panic unwinds before the borrow cleanup runs.
 */
function triggerWasmTrap(activation: WasmCreatureActivation): boolean {
  const fn = getMseSumBatchPackedFn();
  if (!fn) return false;

  // input_size=2 + num_outputs=100 = 102 values per record.
  // Provide exactly 102 values = 1 record, forcing the WASM code to
  // call activate_into with 100 outputs on a 3-neuron network.
  const records = new Float32Array(102);
  try {
    // deno-lint-ignore no-explicit-any
    fn((activation as any).network, records, 2, 100, true);
    return false;
  } catch {
    return true;
  }
}

// ── Normal disposal tests ─────────────────────────────────────────────

Deno.test("WasmOwnershipRecovery: free is idempotent — multiple calls do not throw", () => {
  const activation = createActivation();
  activation.free();
  // Second free should be a no-op, not an error
  activation.free();
  activation.free();
});

Deno.test("WasmOwnershipRecovery: after free, neurons and synapses return zero", () => {
  const activation = createActivation();
  activation.free();
  assertEquals(activation.neurons, 0, "neurons should be 0 after free");
  assertEquals(activation.synapses, 0, "synapses should be 0 after free");
});

Deno.test("WasmOwnershipRecovery: Symbol.dispose frees without throwing", () => {
  const activation = createActivation();
  activation[Symbol.dispose]();
  // Should be freed — activate should throw ACTIVATION_FAILED
  assertThrows(
    () => activation.activate(new Float32Array([0.5, 0.3])),
    WasmError,
  );
});

Deno.test("WasmOwnershipRecovery: Creature.dispose handles WASM cleanup without throwing", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.3]);
  creature.activate(input);
  creature.dispose();
  assertEquals(creature.neurons.length, 0);
  assertEquals(creature.synapses.length, 0);
});

Deno.test("WasmOwnershipRecovery: Creature.clearState disposes WASM and allows reuse", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.3]);
  creature.activate(input);
  creature.clearState();
  const output = creature.activate(input);
  assertEquals(output.length, 1, "should produce 1 output after clearState");
});

Deno.test("WasmOwnershipRecovery: double Creature.dispose does not throw", () => {
  const creature = createTestCreature();
  creature.activate(new Float32Array([0.5, 0.3]));
  creature.dispose();
  creature.dispose();
});

// ── WASM trap recovery tests ──────────────────────────────────────────

Deno.test("WasmOwnershipRecovery: free() recovers after WASM trap leaves borrow dangling", () => {
  const activation = createActivation();

  const trapped = triggerWasmTrap(activation);
  if (!trapped) {
    activation.free();
    return;
  }

  // Critical: free() must not throw even though the CompiledNetwork's
  // wasm-bindgen borrow count is stuck at 1. Before the fix, this threw:
  //   "attempted to take ownership of Rust value while it was borrowed"
  activation.free();

  assertThrows(
    () => activation.activate(new Float32Array([0.5, 0.3])),
    WasmError,
  );
});

Deno.test("WasmOwnershipRecovery: double free after WASM trap is safe", () => {
  const activation = createActivation();
  triggerWasmTrap(activation);

  activation.free();
  activation.free();

  assertEquals(activation.neurons, 0, "Should report 0 neurons after free");
});

Deno.test("WasmOwnershipRecovery: Symbol.dispose works after WASM trap", () => {
  const activation = createActivation();
  triggerWasmTrap(activation);

  activation[Symbol.dispose]();

  assertThrows(
    () => activation.activate(new Float32Array([0.5, 0.3])),
    WasmError,
  );
});

Deno.test("WasmOwnershipRecovery: callBatchFn poisons activation after WASM trap", () => {
  const activation = createActivation();

  const trapped = triggerWasmTrap(activation);
  if (!trapped) {
    activation.free();
    return;
  }

  // The stuck borrow causes a second WASM error when the wrapper tries
  // to call the function. callBatchFn catches it and marks as freed.
  try {
    activation.mseSumBatchPacked(
      new Float32Array([0.5, 0.3, 0.8]),
      2,
      true,
    );
  } catch {
    // Expected: wasm-bindgen borrow error caught by callBatchFn
  }

  // The activation is now freed — subsequent calls get a clean WasmError.
  assertThrows(
    () =>
      activation.mseSumBatchPacked(
        new Float32Array([0.5, 0.3, 0.8]),
        2,
        true,
      ),
    WasmError,
  );

  activation.free();
});

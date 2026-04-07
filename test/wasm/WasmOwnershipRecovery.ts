/**
 * WASM Ownership Recovery Tests
 *
 * Issue #2207 - Verify that WASM activation handles ownership errors
 * gracefully. When a WASM function panics (RuntimeError: unreachable),
 * the Rust borrow counter may not be decremented, leaving the
 * CompiledNetwork in a permanently borrowed state. Subsequent calls to
 * free() must not propagate the ownership error — instead, the
 * activation should be invalidated and the JS reference released for GC.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { WasmError } from "@errors/WasmError.ts";
import { WasmCreatureActivation } from "@wasm/WasmActivation.ts";
import { compileCreatureToWasm } from "@wasm/CompileToWasm.ts";
import { initWasmActivation } from "@wasm/WasmModuleLoader.ts";

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
  // Ensure WASM activation is cached
  const input = new Float32Array([0.5, 0.3]);
  creature.activate(input);
  // dispose should not throw even if WASM has internal issues
  creature.dispose();
  // After dispose, creature should be in a clean state
  assertEquals(creature.neurons.length, 0);
  assertEquals(creature.synapses.length, 0);
});

Deno.test("WasmOwnershipRecovery: Creature.clearState disposes WASM and allows reuse", () => {
  const creature = createTestCreature();
  const input = new Float32Array([0.5, 0.3]);
  // Activate to populate WASM cache
  creature.activate(input);
  // clearState disposes WASM
  creature.clearState();
  // Should be able to activate again (WASM gets re-created)
  const output = creature.activate(input);
  assertEquals(output.length, 1, "should produce 1 output after clearState");
});

Deno.test("WasmOwnershipRecovery: double Creature.dispose does not throw", () => {
  const creature = createTestCreature();
  creature.activate(new Float32Array([0.5, 0.3]));
  creature.dispose();
  // Second dispose should be safe — all resources already released
  creature.dispose();
});

/**
 * Issue #1475 - Type safety: Verify the WasmCompiledNetwork interface
 * matches the actual WASM CompiledNetwork object.
 *
 * These tests create real WASM network objects via WasmCreatureActivation
 * and verify the typed API works correctly at runtime.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertExists,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  initWasmActivation,
  WasmCreatureActivation,
} from "../../src/wasm/mod.ts";
import type {
  WasmCompiledNetwork,
  WasmCompiledNetworkConstructor,
} from "../../src/wasm/mod.ts";
import { getCompiledNetworkClass } from "../../src/wasm/WasmModuleLoader.ts";
import { compileCreatureToWasm } from "../../src/wasm/CompileToWasm.ts";

await initWasmActivation();

// ---------------------------------------------------------------------------
// WasmCompiledNetworkConstructor type
// ---------------------------------------------------------------------------

Deno.test("getCompiledNetworkClass returns a typed constructor", () => {
  const ctor: WasmCompiledNetworkConstructor | null = getCompiledNetworkClass();
  assertExists(ctor, "CompiledNetwork constructor should be available");
  assertEquals(typeof ctor, "function");
});

Deno.test("WasmCompiledNetworkConstructor creates a valid network", () => {
  const ctor = getCompiledNetworkClass();
  assertExists(ctor);

  const creature = new Creature(2, 1);
  const compiled = compileCreatureToWasm(creature);
  const network: WasmCompiledNetwork = new ctor(compiled.data);

  assert(network.num_neurons > 0, "Should have neurons");
  assert(network.num_inputs > 0, "Should have inputs");
  assert(network.num_synapses >= 0, "Synapses should be non-negative");

  network.free();
});

// ---------------------------------------------------------------------------
// WasmCompiledNetwork interface methods
// ---------------------------------------------------------------------------

Deno.test("WasmCompiledNetwork.activate returns correct output length", () => {
  const ctor = getCompiledNetworkClass();
  assertExists(ctor);

  const creature = new Creature(2, 1);
  const compiled = compileCreatureToWasm(creature);
  const network: WasmCompiledNetwork = new ctor(compiled.data);

  const input = new Float32Array([0.5, 0.3]);
  const output = network.activate(input, 1);
  assertEquals(output.length, 1);

  network.free();
});

Deno.test("WasmCompiledNetwork.activate_into produces same output as activate", () => {
  const ctor = getCompiledNetworkClass();
  assertExists(ctor);

  const creature = new Creature(2, 1);
  const compiled = compileCreatureToWasm(creature);
  const network: WasmCompiledNetwork = new ctor(compiled.data);

  const input = new Float32Array([0.5, 0.3]);
  const directOutput = network.activate(input, 1);
  const intoOutput = new Float32Array(1);
  network.activate_into(input, intoOutput);
  assertAlmostEquals(intoOutput[0], directOutput[0], 1e-6);

  network.free();
});

Deno.test("WasmCompiledNetwork.activate_view produces same output as activate", () => {
  const ctor = getCompiledNetworkClass();
  assertExists(ctor);

  const creature = new Creature(2, 1);
  const compiled = compileCreatureToWasm(creature);
  const network: WasmCompiledNetwork = new ctor(compiled.data);

  const input = new Float32Array([0.5, 0.3]);
  const directOutput = network.activate(input, 1);
  const view = network.activate_view(input, 1);
  assertEquals(view.length, 1);
  assertAlmostEquals(view[0], directOutput[0], 1e-6);

  network.free();
});

Deno.test("WasmCompiledNetwork.activate_and_trace returns output and neuron data", () => {
  const ctor = getCompiledNetworkClass();
  assertExists(ctor);

  const creature = new Creature(2, 1);
  const compiled = compileCreatureToWasm(creature);
  const network: WasmCompiledNetwork = new ctor(compiled.data);

  const input = new Float32Array([0.5, 0.3]);
  const result = network.activate_and_trace(input, 1);
  // Trace should include at least one entry per neuron (inputs + hidden + output)
  assert(
    result.length >= network.num_neurons,
    `Trace should have at least ${network.num_neurons} entries, got ${result.length}`,
  );

  network.free();
});

Deno.test("WasmCompiledNetwork.reset_state does not throw", () => {
  const ctor = getCompiledNetworkClass();
  assertExists(ctor);

  const creature = new Creature(2, 1);
  const compiled = compileCreatureToWasm(creature);
  const network: WasmCompiledNetwork = new ctor(compiled.data);

  network.reset_state();

  const input = new Float32Array([0.5, 0.3]);
  const output = network.activate(input, 1);
  assertEquals(output.length, 1);

  network.free();
});

Deno.test("WasmCompiledNetwork.activate results match WasmCreatureActivation", () => {
  const ctor = getCompiledNetworkClass();
  assertExists(ctor);

  const creature = new Creature(2, 1);
  const compiled = compileCreatureToWasm(creature);

  const network: WasmCompiledNetwork = new ctor(compiled.data);
  const activation = WasmCreatureActivation.create(compiled);
  assertExists(activation);

  const input = new Float32Array([0.5, 0.3]);
  const directOutput = network.activate(input, 1);
  const wrapperOutput = activation.activate(input);

  assertAlmostEquals(directOutput[0], wrapperOutput[0], 1e-6);

  network.free();
  activation.free();
});

Deno.test("WasmCompiledNetwork readonly properties match creature topology", () => {
  const ctor = getCompiledNetworkClass();
  assertExists(ctor);

  const creature = new Creature(3, 2);
  const compiled = compileCreatureToWasm(creature);
  const network: WasmCompiledNetwork = new ctor(compiled.data);

  assertEquals(network.num_inputs, 3);
  // num_neurons includes inputs + outputs (at minimum)
  assert(
    network.num_neurons >= 5,
    `Expected at least 5 neurons (3 input + 2 output), got ${network.num_neurons}`,
  );
  assert(
    network.num_synapses >= 0,
    `num_synapses should be non-negative, got ${network.num_synapses}`,
  );

  network.free();
});

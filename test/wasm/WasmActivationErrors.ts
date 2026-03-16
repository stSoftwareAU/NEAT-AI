/**
 * WASM Activation Error Type Tests
 *
 * Issue #1693 - Verify that WasmCreatureActivation methods throw WasmError
 * (not generic Error) with the correct reason codes.
 */

import { assertEquals, assertIsError, assertThrows } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { WasmError } from "../../src/errors/WasmError.ts";
import { WasmCreatureActivation } from "../../src/wasm/WasmActivation.ts";
import { compileCreatureToWasm } from "../../src/wasm/CompileToWasm.ts";
import { initWasmActivation } from "../../src/wasm/WasmModuleLoader.ts";

await initWasmActivation();

function createActivation(): WasmCreatureActivation {
  const creature = new Creature(2, 1);
  creature.fix();
  const compiled = compileCreatureToWasm(creature);
  const activation = WasmCreatureActivation.create(compiled);
  if (!activation) throw new Error("Failed to create WasmCreatureActivation");
  return activation;
}

// --- "freed" errors → ACTIVATION_FAILED ---

Deno.test("WasmActivationErrors: activate throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const err = assertThrows(
    () => activation.activate(new Float32Array([0.5, 0.3])),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: activateView throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const err = assertThrows(
    () => activation.activateView(new Float32Array([0.5, 0.3])),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: activateInto throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const err = assertThrows(
    () =>
      activation.activateInto(
        new Float32Array([0.5, 0.3]),
        new Float32Array(1),
      ),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: activateIntoWithFeedback throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const err = assertThrows(
    () =>
      activation.activateIntoWithFeedback(
        new Float32Array([0.5, 0.3]),
        new Float32Array(1),
        false,
      ),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: activateWithState throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const err = assertThrows(
    () => activation.activateWithState(new Float32Array([0.5, 0.3]), false),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: activateAndTrace throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const err = assertThrows(
    () => activation.activateAndTrace(new Float32Array([0.5, 0.3])),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: activateAndTraceWithFeedback throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const err = assertThrows(
    () =>
      activation.activateAndTraceWithFeedback(
        new Float32Array([0.5, 0.3]),
        false,
      ),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: activateAndTraceBatch4Way throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const inputs: [Float32Array, Float32Array, Float32Array, Float32Array] = [
    new Float32Array([0.1, 0.2]),
    new Float32Array([0.3, 0.4]),
    new Float32Array([0.5, 0.6]),
    new Float32Array([0.7, 0.8]),
  ];
  const err = assertThrows(
    () => activation.activateAndTraceBatch4Way(inputs),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: activateAndTraceBatch4WayWithFeedback throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const inputs: [Float32Array, Float32Array, Float32Array, Float32Array] = [
    new Float32Array([0.1, 0.2]),
    new Float32Array([0.3, 0.4]),
    new Float32Array([0.5, 0.6]),
    new Float32Array([0.7, 0.8]),
  ];
  const err = assertThrows(
    () => activation.activateAndTraceBatch4WayWithFeedback(inputs, false),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: mseSumBatchPacked throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const records = new Float32Array([0.5, 0.3, 0.8]);
  const err = assertThrows(
    () => activation.mseSumBatchPacked(records, 2, true),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: maeSumBatchPacked throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const records = new Float32Array([0.5, 0.3, 0.8]);
  const err = assertThrows(
    () => activation.maeSumBatchPacked(records, 2, true),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: crossEntropySumBatchPacked throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const records = new Float32Array([0.5, 0.3, 0.8]);
  const err = assertThrows(
    () => activation.crossEntropySumBatchPacked(records, 2, true),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: mapeSumBatchPacked throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const records = new Float32Array([0.5, 0.3, 0.8]);
  const err = assertThrows(
    () => activation.mapeSumBatchPacked(records, 2, true),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: msleSumBatchPacked throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const records = new Float32Array([0.5, 0.3, 0.8]);
  const err = assertThrows(
    () => activation.msleSumBatchPacked(records, 2, true),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

Deno.test("WasmActivationErrors: hingeSumBatchPacked throws WasmError after free", () => {
  const activation = createActivation();
  activation.free();
  const records = new Float32Array([0.5, 0.3, 0.8]);
  const err = assertThrows(
    () => activation.hingeSumBatchPacked(records, 2, true),
    WasmError,
  );
  assertEquals(
    (err as WasmError).reason,
    "ACTIVATION_FAILED",
    "Expected ACTIVATION_FAILED reason code",
  );
});

// --- Input length mismatch → ACTIVATION_FAILED ---

Deno.test("WasmActivationErrors: activate throws WasmError on input length mismatch", () => {
  const activation = createActivation();
  try {
    const err = assertThrows(
      () => activation.activate(new Float32Array([0.5])), // expects 2 inputs
      WasmError,
    );
    assertIsError(err, WasmError);
  } finally {
    activation.free();
  }
});

Deno.test("WasmActivationErrors: activateView throws WasmError on input length mismatch", () => {
  const activation = createActivation();
  try {
    assertThrows(
      () => activation.activateView(new Float32Array([0.5])),
      WasmError,
    );
  } finally {
    activation.free();
  }
});

Deno.test("WasmActivationErrors: activateInto throws WasmError on input length mismatch", () => {
  const activation = createActivation();
  try {
    assertThrows(
      () =>
        activation.activateInto(new Float32Array([0.5]), new Float32Array(1)),
      WasmError,
    );
  } finally {
    activation.free();
  }
});

Deno.test("WasmActivationErrors: activateInto throws WasmError on output buffer length mismatch", () => {
  const activation = createActivation();
  try {
    assertThrows(
      () =>
        activation.activateInto(
          new Float32Array([0.5, 0.3]),
          new Float32Array(5), // expects 1 output
        ),
      WasmError,
    );
  } finally {
    activation.free();
  }
});

Deno.test("WasmActivationErrors: activateAndTrace throws WasmError on input length mismatch", () => {
  const activation = createActivation();
  try {
    assertThrows(
      () => activation.activateAndTrace(new Float32Array([0.5])),
      WasmError,
    );
  } finally {
    activation.free();
  }
});

Deno.test("WasmActivationErrors: activateAndTraceBatch4Way throws WasmError on input length mismatch", () => {
  const activation = createActivation();
  try {
    const inputs: [Float32Array, Float32Array, Float32Array, Float32Array] = [
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3]), // wrong length
      new Float32Array([0.5, 0.6]),
      new Float32Array([0.7, 0.8]),
    ];
    assertThrows(
      () => activation.activateAndTraceBatch4Way(inputs),
      WasmError,
    );
  } finally {
    activation.free();
  }
});

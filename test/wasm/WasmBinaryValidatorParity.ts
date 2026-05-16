/**
 * Issue #2686 — Rust-constructor parity checks for `assertWasmBinaryWellFormed`.
 *
 * The base validator (#2643, #2667) mirrors the explicit `return Err` arms of
 * `CompiledNetwork::new` in the pinned NEAT-AI-core revision
 * (`wasm_activation/pkg/neat_core_rev.txt`): header underflow, neuron header
 * underflow, synapse record underflow, `num_inputs > num_neurons`, trailing
 * bytes, and `from_index >= num_neurons`. The GRQ-2681 traps reach
 * `unreachable` *despite* passing those checks, so this suite extends the
 * validator with defensive parity checks for the remaining well-formedness
 * invariants the producer must honour:
 *
 *   1. `squash_type` byte in `0..=37` (matches `SquashType.ts` and
 *      `neat-core/src/squash.rs`). Rust's `From<u8>` silently falls back to
 *      `Identity` for out-of-range, masking a real producer bug. The
 *      validator catches it loud.
 *   2. `isConstant` flag is exactly `0` or `1`. Rust treats any non-zero as
 *      true, so an out-of-range byte (e.g. `0x42`) is silently accepted, but
 *      again the producer should never emit one.
 *   3. `synapseType` byte in `0..=3` (Standard/Condition/Negative/Positive).
 *      Rust's `From<u8>` falls back to `Standard`.
 *   4. `f64 bias` and `f64 weight` are finite (no `NaN`, no `±Inf`). The
 *      activation paths multiply, sum, and clamp these values and finite
 *      values are the contract.
 *   5. A constant neuron declares `num_synapses == 0`. Constants are leaves
 *      — an inward synapse is wasted bytes at best and a serialiser bug at
 *      worst.
 *
 * Every test engineers a single defective byte buffer and asserts the
 * validator throws `WasmError("COMPILATION_FAILED")` with a message naming
 * the offending field. A round-trip control test confirms a healthy buffer
 * passes the new checks.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { compileCreatureToWasm } from "@wasm/CompileToWasm.ts";
import { SquashType } from "@wasm/SquashType.ts";
import { assertWasmBinaryWellFormed } from "@wasm/WasmBinaryValidator.ts";
import { WasmError } from "@errors/WasmError.ts";

/** Concatenate a header (numNeurons, numInputs) onto neuron records. */
function buildBinary(
  numNeurons: number,
  numInputs: number,
  body: Uint8Array,
): Uint8Array {
  const buf = new Uint8Array(8 + body.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, numNeurons, true);
  view.setUint32(4, numInputs, true);
  buf.set(body, 8);
  return buf;
}

/**
 * Build the body for one non-input neuron with `numSynapses` synapse records.
 * Defaults produce a well-formed neuron: identity squash, non-constant, all
 * synapses pulling from input 0 with finite weights.
 */
function buildNeuronBody(
  options: {
    bias?: number;
    squash?: number;
    isConstant?: number;
    numSynapses?: number;
    synapses?: Array<{
      fromIndex?: number;
      synapseType?: number;
      weight?: number;
    }>;
  } = {},
): Uint8Array {
  type SynapseSpec = {
    fromIndex?: number;
    synapseType?: number;
    weight?: number;
  };
  const numSynapses = options.numSynapses ?? options.synapses?.length ?? 0;
  const synapses: SynapseSpec[] = options.synapses ??
    Array.from({ length: numSynapses }, (): SynapseSpec => ({}));
  const body = new Uint8Array(12 + 12 * numSynapses);
  const view = new DataView(body.buffer);
  view.setFloat64(0, options.bias ?? 0, true);
  view.setUint8(8, options.squash ?? SquashType.Identity);
  view.setUint8(9, options.isConstant ?? 0);
  view.setUint16(10, numSynapses, true);
  for (let i = 0; i < numSynapses; i++) {
    const off = 12 + i * 12;
    const s = synapses[i] ?? {};
    view.setUint16(off, s.fromIndex ?? 0, true);
    view.setUint8(off + 2, s.synapseType ?? 0);
    view.setUint8(off + 3, 0); // padding
    view.setFloat64(off + 4, s.weight ?? 0.5, true);
  }
  return body;
}

// =============================================================================
// Control: a healthy round-trip must still pass the extended validator.
// =============================================================================

Deno.test(
  "Issue #2686: a real compileCreatureToWasm round-trip passes the extended validator (no false positives)",
  () => {
    const creature = new Creature(3, 2);
    creature.fix();
    const compiled = compileCreatureToWasm(creature);
    // compileCreatureToWasm already runs the validator internally, so reaching
    // this point proves the new checks accept healthy bytes. Re-invoke for
    // explicitness: any throw here is a false positive.
    assertWasmBinaryWellFormed(compiled.data);
  },
);

// =============================================================================
// Invariant 1: squash_type byte must be in 0..=37.
// =============================================================================

Deno.test(
  "Issue #2686: rejects out-of-range squash_type (38, just past the enum)",
  () => {
    const body = buildNeuronBody({ squash: 38 });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("squash_type=38"),
      `expected message to name squash_type=38, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: rejects out-of-range squash_type (255, the u8 max)",
  () => {
    const body = buildNeuronBody({ squash: 255 });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("squash_type=255"),
      `expected message to name squash_type=255, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: accepts squash_type = 37 (Mean, the largest valid value)",
  () => {
    const body = buildNeuronBody({ squash: SquashType.Mean });
    const data = buildBinary(3, 2, body);
    assertWasmBinaryWellFormed(data);
  },
);

// =============================================================================
// Invariant 2: isConstant flag must be 0 or 1.
// =============================================================================

Deno.test(
  "Issue #2686: rejects isConstant = 2 (must be strictly 0 or 1)",
  () => {
    const body = buildNeuronBody({ isConstant: 2 });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("is_constant=2"),
      `expected message to name is_constant=2, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: rejects isConstant = 255 (u8 max)",
  () => {
    const body = buildNeuronBody({ isConstant: 255 });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("is_constant=255"),
      `expected message to name is_constant=255, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: accepts isConstant = 1 (constant neuron with zero synapses)",
  () => {
    const body = buildNeuronBody({ isConstant: 1, numSynapses: 0 });
    const data = buildBinary(3, 2, body);
    assertWasmBinaryWellFormed(data);
  },
);

// =============================================================================
// Invariant 3: synapse_type byte must be in 0..=3.
// =============================================================================

Deno.test(
  "Issue #2686: rejects out-of-range synapse_type (4, just past Positive)",
  () => {
    const body = buildNeuronBody({
      synapses: [{ synapseType: 4 }],
    });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("synapse_type=4"),
      `expected message to name synapse_type=4, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: rejects out-of-range synapse_type (255, u8 max)",
  () => {
    const body = buildNeuronBody({
      synapses: [{ synapseType: 255 }],
    });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("synapse_type=255"),
      `expected message to name synapse_type=255, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: accepts synapse_type = 3 (Positive, the largest valid value)",
  () => {
    const body = buildNeuronBody({
      synapses: [{ synapseType: 3 }],
    });
    const data = buildBinary(3, 2, body);
    assertWasmBinaryWellFormed(data);
  },
);

// =============================================================================
// Invariant 4: bias and weight must be finite (no NaN, no ±Inf).
// =============================================================================

Deno.test(
  "Issue #2686: rejects NaN bias",
  () => {
    const body = buildNeuronBody({ bias: Number.NaN });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("bias"),
      `expected message to name bias, got: ${err.message}`,
    );
    assert(
      err.message.toLowerCase().includes("nan") ||
        err.message.toLowerCase().includes("non-finite"),
      `expected message to flag non-finite bias, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: rejects +Inf bias",
  () => {
    const body = buildNeuronBody({ bias: Number.POSITIVE_INFINITY });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("bias"),
      `expected message to name bias, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: rejects -Inf bias",
  () => {
    const body = buildNeuronBody({ bias: Number.NEGATIVE_INFINITY });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("bias"),
      `expected message to name bias, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: rejects NaN synapse weight",
  () => {
    const body = buildNeuronBody({
      synapses: [{ weight: Number.NaN }],
    });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("weight"),
      `expected message to name weight, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: rejects +Inf synapse weight",
  () => {
    const body = buildNeuronBody({
      synapses: [{ weight: Number.POSITIVE_INFINITY }],
    });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("weight"),
      `expected message to name weight, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: accepts finite bias and weight (near-zero and large)",
  () => {
    const body = buildNeuronBody({
      bias: 1e-15,
      synapses: [{ weight: 1e15 }],
    });
    const data = buildBinary(3, 2, body);
    assertWasmBinaryWellFormed(data);
  },
);

// =============================================================================
// Invariant 5: constant neurons must declare num_synapses == 0.
// =============================================================================

Deno.test(
  "Issue #2686: rejects constant neuron with one inward synapse",
  () => {
    const body = buildNeuronBody({
      isConstant: 1,
      synapses: [{ fromIndex: 0 }],
    });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("constant"),
      `expected message to flag constant, got: ${err.message}`,
    );
    assert(
      err.message.includes("num_synapses=1"),
      `expected message to name num_synapses=1, got: ${err.message}`,
    );
  },
);

Deno.test(
  "Issue #2686: rejects constant neuron with many inward synapses",
  () => {
    const body = buildNeuronBody({
      isConstant: 1,
      synapses: [{ fromIndex: 0 }, { fromIndex: 1 }, { fromIndex: 0 }],
    });
    const data = buildBinary(3, 2, body);
    const err = assertThrows(
      () => assertWasmBinaryWellFormed(data),
      WasmError,
    );
    assertEquals(err.reason, "COMPILATION_FAILED");
    assert(
      err.message.includes("num_synapses=3"),
      `expected message to name num_synapses=3, got: ${err.message}`,
    );
  },
);

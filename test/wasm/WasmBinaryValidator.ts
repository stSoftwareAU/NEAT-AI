/**
 * Issue #2643 — Producer-side rejection of malformed WASM creature blobs.
 *
 * GRQ-7 logs (NEAT-AI 5.0.1) show 1056 strikes of `Data too short for neuron`
 * during evolve at constant shape `inputs=2054, outputs=3` with varying neuron
 * counts (2106, 2122, ...). The downstream call-site recovery (#2483) drops
 * the offspring but the producer has already burnt compute on a genome the
 * WASM constructor cannot decode.
 *
 * `assertWasmBinaryWellFormed` mirrors the NEAT-AI-core byte-walk in TS so a
 * malformed blob is rejected before the WASM constructor sees it. These tests
 * exercise:
 *
 *   1. The canonical strike shape (`neurons=2106, inputs=2054, outputs=3`)
 *      emitted by the real producer path (AddNeuron) compiles round-trip
 *      through both serialiser variants. Acceptance criterion 2.
 *   2. The serialiser refuses to emit a blob whose `creature.input` exceeds
 *      `creature.neurons.length` — the canonical header inconsistency.
 *   3. Direct buffer-level checks for every Rust decoder failure mode:
 *      short header, `num_inputs > num_neurons`, short body, short synapse,
 *      out-of-range `from_index`, and trailing bytes.
 *   4. A well-formed buffer passes the validator (control case).
 *
 * The strike-shape test costs one real WASM compile of a 2106-neuron creature
 * (~25 KB of bytes). Bounded by the existing AddNeuron retry budget.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { compileCreatureToWasm } from "@wasm/CompileToWasm.ts";
import { WasmCreatureActivation } from "@wasm/WasmActivation.ts";
import { initWasmActivation } from "@wasm/WasmModuleLoader.ts";
import { ensureProducerOutputCompiles } from "@wasm/ProducerCompileGuard.ts";
import { SquashType } from "@wasm/SquashType.ts";
import { assertWasmBinaryWellFormed } from "@wasm/WasmBinaryValidator.ts";
import { WasmError } from "@errors/WasmError.ts";

await initWasmActivation();

const GRQ7_INPUTS = 2054;
const GRQ7_OUTPUTS = 3;
const GRQ7_HIDDEN = 49; // 2054 + 49 + 3 = 2106 — the canonical strike shape
const GRQ7_NEURONS = GRQ7_INPUTS + GRQ7_HIDDEN + GRQ7_OUTPUTS;

function buildGrq7Shape(): Creature {
  const creature = new Creature(GRQ7_INPUTS, GRQ7_OUTPUTS);
  creature.fix();
  let added = 0;
  for (
    let attempt = 0;
    attempt < GRQ7_HIDDEN * 5 && added < GRQ7_HIDDEN;
    attempt++
  ) {
    const op = new AddNeuron(creature);
    if (op.mutate()) {
      added++;
    }
  }
  assertEquals(
    added,
    GRQ7_HIDDEN,
    `failed to seed ${GRQ7_HIDDEN} hidden neurons in bounded attempts`,
  );
  return creature;
}

Deno.test(
  "Issue #2643: GRQ-7 strike-shape (neurons=2106, inputs=2054, outputs=3) round-trips through compileCreatureToWasm",
  () => {
    const creature = buildGrq7Shape();
    assertEquals(creature.neurons.length, GRQ7_NEURONS);
    assertEquals(creature.input, GRQ7_INPUTS);
    assertEquals(creature.output, GRQ7_OUTPUTS);

    // The producer path must emit a blob that the WASM constructor accepts —
    // no `Data too short for neuron`, no `unreachable`.
    const compiled = compileCreatureToWasm(creature);
    assertEquals(compiled.numNeurons, GRQ7_NEURONS);
    assertEquals(compiled.numInputs, GRQ7_INPUTS);
    assertEquals(compiled.numOutputs, GRQ7_OUTPUTS);

    const activation = WasmCreatureActivation.create(compiled);
    assert(
      activation !== null,
      "GRQ-7 strike shape must compile through WasmCreatureActivation.create",
    );
    activation!.free();
  },
);

Deno.test(
  "Issue #2643: GRQ-7 strike-shape compiles via the producer gate (ensureProducerOutputCompiles)",
  () => {
    const creature = buildGrq7Shape();
    const result = ensureProducerOutputCompiles(creature);
    assert(
      result.ok,
      `producer gate must accept GRQ-7 shape, got: ${result.trapMessage}`,
    );
  },
);

Deno.test(
  "Issue #2643: serialiser rejects header drift (input > neurons.length) before reaching WASM",
  () => {
    const creature = new Creature(3, 2);
    creature.fix();
    // Force the canonical header inconsistency that would otherwise reach the
    // WASM constructor and trap. The serialiser must throw a typed error
    // BEFORE handing bytes to WASM so the producer gate can revert the
    // mutation cleanly.
    (creature as unknown as { input: number }).input = creature.neurons.length +
      5;

    let caught: unknown = null;
    try {
      compileCreatureToWasm(creature);
    } catch (err) {
      caught = err;
    }
    assert(
      caught instanceof WasmError,
      `expected WasmError from compileCreatureToWasm, got ${caught}`,
    );
    assertEquals(
      (caught as WasmError).reason,
      "COMPILATION_FAILED",
      "header drift must surface as COMPILATION_FAILED",
    );
    assert(
      (caught as WasmError).message.includes("num_inputs"),
      `error message must name num_inputs/num_neurons: ${
        (caught as WasmError).message
      }`,
    );
  },
);

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

Deno.test("Issue #2643: assertWasmBinaryWellFormed accepts a well-formed binary", () => {
  // 2 inputs + 1 hidden, hidden takes one inward synapse from input 0.
  const body = new Uint8Array(12 + 12);
  const view = new DataView(body.buffer);
  view.setFloat64(0, 0, true);
  view.setUint8(8, SquashType.Identity);
  view.setUint8(9, 0);
  view.setUint16(10, 1, true);
  view.setUint16(12, 0, true); // from_index = 0
  view.setUint8(14, 0); // synapse_type
  view.setUint8(15, 0); // padding
  view.setFloat64(16, 0.5, true); // weight
  const data = buildBinary(3, 2, body);
  // Must not throw.
  assertWasmBinaryWellFormed(data);
});

Deno.test("Issue #2643: assertWasmBinaryWellFormed rejects buffer shorter than header", () => {
  const err = assertThrows(
    () => assertWasmBinaryWellFormed(new Uint8Array(4)),
    WasmError,
  );
  assert(err.message.includes("too short for header"));
});

Deno.test("Issue #2643: assertWasmBinaryWellFormed rejects num_inputs > num_neurons", () => {
  // Header-only buffer claiming 2 inputs but only 1 neuron total.
  const data = buildBinary(1, 2, new Uint8Array(0));
  const err = assertThrows(
    () => assertWasmBinaryWellFormed(data),
    WasmError,
  );
  assert(err.message.includes("num_inputs=2"));
  assert(err.message.includes("num_neurons=1"));
});

Deno.test("Issue #2643: assertWasmBinaryWellFormed rejects body short of declared neurons", () => {
  // Header declares 1 non-input neuron, but body has 0 bytes.
  const data = buildBinary(3, 2, new Uint8Array(0));
  const err = assertThrows(
    () => assertWasmBinaryWellFormed(data),
    WasmError,
  );
  assert(
    err.message.includes("too short for neuron"),
    `expected short-neuron message, got: ${err.message}`,
  );
});

Deno.test("Issue #2643: assertWasmBinaryWellFormed rejects over-declared num_synapses", () => {
  // Neuron header declares 5 synapses but body has none.
  const body = new Uint8Array(12);
  const view = new DataView(body.buffer);
  view.setUint16(10, 5, true); // num_synapses = 5
  const data = buildBinary(3, 2, body);
  const err = assertThrows(
    () => assertWasmBinaryWellFormed(data),
    WasmError,
  );
  assert(
    err.message.includes("too short for synapse"),
    `expected short-synapse message, got: ${err.message}`,
  );
});

Deno.test("Issue #2643: assertWasmBinaryWellFormed tolerates out-of-range from_index (runtime trap path)", () => {
  // Synapse from_index = 99 but num_neurons = 3. The Rust decoder accepts
  // this and lets the trap surface at activate time — see Issue #2146/#2484
  // (`ACTIVATION_FAILED` recovery). The validator must not pre-empt that
  // path, otherwise those tests change semantics.
  const body = new Uint8Array(12 + 12);
  const view = new DataView(body.buffer);
  view.setUint16(10, 1, true); // num_synapses = 1
  view.setUint16(12, 99, true); // from_index = 99 (out of range)
  const data = buildBinary(3, 2, body);
  // Must NOT throw.
  assertWasmBinaryWellFormed(data);
});

Deno.test("Issue #2643: assertWasmBinaryWellFormed rejects trailing bytes after declared shape", () => {
  // Declared shape consumes 8 + 12 = 20 bytes, but buffer is 24.
  const body = new Uint8Array(12 + 4); // one neuron header + 4 stray bytes
  const data = buildBinary(3, 2, body);
  const err = assertThrows(
    () => assertWasmBinaryWellFormed(data),
    WasmError,
  );
  assert(
    err.message.includes("consumes 20 bytes"),
    `expected trailing-byte message, got: ${err.message}`,
  );
});

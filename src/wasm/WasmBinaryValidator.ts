/**
 * WasmBinaryValidator.ts — Producer-side self-consistency check for the WASM
 * creature activation binary.
 *
 * Issue #2643: GRQ-7 logs show the NEAT-AI-core constructor returning
 * `Err("Data too short for neuron")` for blobs emitted by the mutation /
 * breeding pipeline. The trap fires inside the byte-walk in
 * `neat-core/src/network.rs::CompiledNetwork::new` when the declared header
 * counts disagree with the bytes that follow. The downstream call-site
 * recovery (#2483) drops the offspring, but the producer has already burnt
 * the compute that built the bad genome.
 *
 * This module mirrors the Rust byte-walk inside the TS producer so a
 * malformed blob is rejected synchronously at serialise time — long before
 * the WASM constructor sees it. A throw here surfaces as `{ ok: false }` in
 * `ensureProducerOutputCompiles`, which the mutate/breed gates already revert
 * on (#2636), so the bad topology never leaves the producer.
 *
 * Mirrored decoder: `wasm_activation/pkg/neat_core_rev.txt`.
 */

import { WasmError } from "@errors/WasmError.ts";

/** Header (u32 num_neurons + u32 num_inputs). */
const HEADER_SIZE = 8;

/** Per non-input neuron header bytes (f64 bias + u8 squash + u8 isConstant + u16 numSynapses). */
const NEURON_HEADER_SIZE = 12;

/** Per synapse record bytes (u16 from + u8 type + u8 pad + f64 weight). */
const SYNAPSE_RECORD_SIZE = 12;

/**
 * Walk the bytes the way the NEAT-AI-core decoder does and throw if the
 * buffer would fail to decode. The check is cheap (one linear pass, no
 * allocations) and exhaustive: it catches the canonical strike shapes
 * (`num_inputs > num_neurons`, short body, over-declared `num_synapses`,
 * trailing bytes, out-of-range `from_index`).
 *
 * @throws {WasmError} when the buffer would not decode cleanly. Reason is
 *   always `"COMPILATION_FAILED"` — callers (the producer gate) treat any
 *   throw from the WASM compile path as a reject signal.
 */
export function assertWasmBinaryWellFormed(data: Uint8Array): void {
  if (data.length < HEADER_SIZE) {
    throw new WasmError(
      `Producer emitted WASM binary too short for header: ${data.length} bytes (need ${HEADER_SIZE}).`,
      "COMPILATION_FAILED",
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numNeurons = view.getUint32(0, true);
  const numInputs = view.getUint32(4, true);

  // The Rust decoder computes `num_non_inputs = num_neurons - num_inputs`
  // as `usize`. When `num_inputs > num_neurons` this underflows to ~4e9 and
  // the per-neuron loop traps. Reject this shape with an explicit message.
  if (numInputs > numNeurons) {
    throw new WasmError(
      `Producer emitted WASM binary with num_inputs=${numInputs} > num_neurons=${numNeurons}; ` +
        `the loader would underflow num_non_inputs.`,
      "COMPILATION_FAILED",
    );
  }

  let offset = HEADER_SIZE;
  const nonInputs = numNeurons - numInputs;
  for (let n = 0; n < nonInputs; n++) {
    if (offset + NEURON_HEADER_SIZE > data.length) {
      throw new WasmError(
        `Producer emitted WASM binary too short for neuron ${n} of ${nonInputs} ` +
          `(offset=${offset}, length=${data.length}, num_neurons=${numNeurons}, ` +
          `num_inputs=${numInputs}).`,
        "COMPILATION_FAILED",
      );
    }
    const numSynapses = view.getUint16(offset + 10, true);
    offset += NEURON_HEADER_SIZE;

    for (let s = 0; s < numSynapses; s++) {
      if (offset + SYNAPSE_RECORD_SIZE > data.length) {
        throw new WasmError(
          `Producer emitted WASM binary too short for synapse ${s} of neuron ${n} ` +
            `(declared num_synapses=${numSynapses}, offset=${offset}, length=${data.length}).`,
          "COMPILATION_FAILED",
        );
      }
      // Note: `from_index` is intentionally NOT bounds-checked here. The Rust
      // decoder accepts any u16, and an out-of-range index manifests as a
      // runtime trap during `activate` (covered by #2146 / #2484). Catching
      // it here would silently change behaviour of those existing recovery
      // tests, which is out of scope for #2643.
      offset += SYNAPSE_RECORD_SIZE;
    }
  }

  if (offset !== data.length) {
    // Either trailing bytes (producer over-allocated) or short tail. Both
    // indicate header/body drift — the Rust decoder would silently ignore
    // trailing bytes but the trailing case is still a producer bug worth
    // catching before WASM compile.
    throw new WasmError(
      `Producer emitted WASM binary whose declared shape (num_neurons=${numNeurons}, ` +
        `num_inputs=${numInputs}) consumes ${offset} bytes but buffer length is ${data.length}.`,
      "COMPILATION_FAILED",
    );
  }
}

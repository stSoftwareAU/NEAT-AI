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
 *
 * # Rust invariants mirrored
 *
 * The pinned `neat-core/src/network.rs::CompiledNetwork::new` (revision
 * recorded in `wasm_activation/pkg/neat_core_rev.txt`) has three explicit
 * `return Err` arms plus a usize-underflow on `num_neurons - num_inputs`.
 * Beyond those, the constructor stores raw `u8`s for `squash_type`,
 * `is_constant`, and `synapse_type` and defers interpretation to the
 * `From<u8>` impls in `squash.rs` and `synapse_type.rs`. Both impls silently
 * fall back to `Identity` / `Standard` for out-of-range bytes, which masks
 * producer bugs. The validator catches those producer bugs loud rather than
 * letting them silently degrade activation behaviour.
 *
 * | Invariant                                              | Source (pinned rev)                          |
 * | ------------------------------------------------------ | -------------------------------------------- |
 * | `data.len() >= 8` (header bytes)                       | `network.rs:132-134`                         |
 * | `num_inputs <= num_neurons` (usize underflow on diff)  | `network.rs:136-138`                         |
 * | Neuron header has 12 bytes of body remaining           | `network.rs:146-148`                         |
 * | Synapse record has 12 bytes of body remaining          | `network.rs:169-171`                         |
 * | `from_index < num_neurons` (Issue #2667)               | `network.rs:417` (activate-time index)       |
 * | `squash_type` byte in `0..=37`                         | `squash.rs:77-121` (enum + From<u8> total)   |
 * | `is_constant` byte in `{0, 1}`                         | `network.rs:161` (`data[offset+9] != 0`)     |
 * | `synapse_type` byte in `0..=3`                         | `synapse_type.rs:21-30` (From<u8> total)     |
 * | `bias` and `weight` are finite (no NaN, no ±Inf)       | `network.rs:150-159, 176-185` (decode path)  |
 * | Constant neurons declare `num_synapses == 0`           | `network.rs:236-238` (synapses never read)   |
 * | `offset == data.len()` at end (no trailing bytes)      | `network.rs:142-203` (post-walk byte count)  |
 *
 * The last three are defensive parity checks (#2686). Rust silently accepts
 * them today, but they all indicate a producer bug worth catching before the
 * blob leaves the producer.
 */

import { WasmError } from "@errors/WasmError.ts";

/** Header (u32 num_neurons + u32 num_inputs). */
const HEADER_SIZE = 8;

/** Per non-input neuron header bytes (f64 bias + u8 squash + u8 isConstant + u16 numSynapses). */
const NEURON_HEADER_SIZE = 12;

/** Per synapse record bytes (u16 from + u8 type + u8 pad + f64 weight). */
const SYNAPSE_RECORD_SIZE = 12;

/**
 * Largest valid `squash_type` byte. Matches `SquashType.Mean = 37` in
 * `src/wasm/SquashType.ts` and the corresponding enum in
 * `neat-core/src/squash.rs`. Rust's `From<u8>` falls back to `Identity` for
 * out-of-range bytes, so this check catches producer bugs that would
 * otherwise be silently coerced.
 */
const MAX_SQUASH_TYPE = 37;

/**
 * Largest valid `synapse_type` byte. Matches `SynapseType::Positive = 3` in
 * `neat-core/src/synapse_type.rs`. Rust's `From<u8>` falls back to
 * `Standard` for out-of-range bytes.
 */
const MAX_SYNAPSE_TYPE = 3;

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
    // Issue #2686: defensive parity checks on the neuron header fields the
    // Rust constructor stores raw and interprets lazily.
    const bias = view.getFloat64(offset, true);
    if (!Number.isFinite(bias)) {
      throw new WasmError(
        `Producer emitted WASM binary with non-finite bias=${bias} ` +
          `(neuron ${n} of ${nonInputs}, offset=${offset}).`,
        "COMPILATION_FAILED",
      );
    }
    const squashType = view.getUint8(offset + 8);
    if (squashType > MAX_SQUASH_TYPE) {
      throw new WasmError(
        `Producer emitted WASM binary with out-of-range squash_type=${squashType} ` +
          `(neuron ${n} of ${nonInputs}, valid range 0..=${MAX_SQUASH_TYPE}).`,
        "COMPILATION_FAILED",
      );
    }
    const isConstantByte = view.getUint8(offset + 9);
    if (isConstantByte > 1) {
      throw new WasmError(
        `Producer emitted WASM binary with out-of-range is_constant=${isConstantByte} ` +
          `(neuron ${n} of ${nonInputs}, valid range 0..=1).`,
        "COMPILATION_FAILED",
      );
    }
    const numSynapses = view.getUint16(offset + 10, true);
    // Issue #2686: constants are leaves — no inward synapses. Rust would
    // store the synapse vector and silently ignore it during activation
    // (the `if neuron.is_constant` branch never reads synapses), so this
    // catches a producer bug Rust would otherwise paper over.
    if (isConstantByte === 1 && numSynapses !== 0) {
      throw new WasmError(
        `Producer emitted WASM binary with constant neuron declaring ` +
          `num_synapses=${numSynapses} (neuron ${n} of ${nonInputs}); ` +
          `constants must be leaves.`,
        "COMPILATION_FAILED",
      );
    }
    offset += NEURON_HEADER_SIZE;

    for (let s = 0; s < numSynapses; s++) {
      if (offset + SYNAPSE_RECORD_SIZE > data.length) {
        throw new WasmError(
          `Producer emitted WASM binary too short for synapse ${s} of neuron ${n} ` +
            `(declared num_synapses=${numSynapses}, offset=${offset}, length=${data.length}).`,
          "COMPILATION_FAILED",
        );
      }
      // Issue #2667: bounds-check `from_index`. The original #2643 validator
      // deferred this to the runtime trap path, but #2666 logs show the trap
      // firing inside `CompiledNetwork::new` for small creatures (neurons≈36,
      // inputs=7, outputs=3) — well before `activate` is called — so the gap
      // is closed producer-side. Reading at the same offset keeps the walk
      // O(n) and allocation-free.
      const fromIndex = view.getUint16(offset, true);
      if (fromIndex >= numNeurons) {
        throw new WasmError(
          `Producer emitted WASM binary with out-of-range synapse from_index=${fromIndex} ` +
            `(neuron ${n} of ${nonInputs}, synapse ${s} of ${numSynapses}, ` +
            `num_neurons=${numNeurons}).`,
          "COMPILATION_FAILED",
        );
      }
      // Issue #2686: synapse_type byte must map to a real enum variant.
      // Rust's `From<u8>` silently folds out-of-range to `Standard`.
      const synapseType = view.getUint8(offset + 2);
      if (synapseType > MAX_SYNAPSE_TYPE) {
        throw new WasmError(
          `Producer emitted WASM binary with out-of-range synapse_type=${synapseType} ` +
            `(neuron ${n} of ${nonInputs}, synapse ${s} of ${numSynapses}, ` +
            `valid range 0..=${MAX_SYNAPSE_TYPE}).`,
          "COMPILATION_FAILED",
        );
      }
      // Issue #2686: weight must be finite. Activation paths assume finite
      // f32 values for SIMD sums, clamps, and aggregate comparisons.
      const weight = view.getFloat64(offset + 4, true);
      if (!Number.isFinite(weight)) {
        throw new WasmError(
          `Producer emitted WASM binary with non-finite synapse weight=${weight} ` +
            `(neuron ${n} of ${nonInputs}, synapse ${s} of ${numSynapses}, ` +
            `offset=${offset + 4}).`,
          "COMPILATION_FAILED",
        );
      }
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

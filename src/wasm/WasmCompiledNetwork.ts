/**
 * TypeScript interface for the WASM CompiledNetwork object.
 *
 * Issue #1475 - Type safety: Replace remaining `any` types in WASM activation layer.
 *
 * This interface mirrors the public API of the `CompiledNetwork` class defined
 * in `wasm_activation/pkg/wasm_activation.d.ts`, providing compile-time type
 * checking without importing from the WASM-generated bindings directly (which
 * would trigger module loading).
 *
 * Property names use snake_case (quoted) to match the Rust-generated WASM
 * bindings exactly.
 */

/**
 * Interface describing the compiled WASM network object.
 *
 * A `WasmCompiledNetwork` is constructed from serialised neuron/synapse data
 * and provides activation, tracing, and batch scoring entry points that
 * execute entirely inside WASM.
 */
export interface WasmCompiledNetwork {
  /** Release WASM-side memory. Safe to call multiple times. */
  free(): void;

  /** Disposable protocol for `using` declarations. */
  [Symbol.dispose](): void;

  /**
   * Activate the network with the given input values.
   * Returns the output values as a new Float32Array.
   */
  activate(input: Float32Array, num_outputs: number): Float32Array;

  /**
   * Activate the network and return a zero-copy Float32Array view over
   * WASM memory.  The view is overwritten by subsequent activations.
   */
  // deno-lint-ignore camelcase
  activate_view(input: Float32Array, num_outputs: number): Float32Array;

  /**
   * Activate the network, writing results into a pre-allocated output buffer.
   */
  // deno-lint-ignore camelcase
  activate_into(input: Float32Array, output: Float32Array): void;

  /**
   * Activate the network with tracing for backpropagation support.
   * Returns a combined Float32Array of outputs, activations, hint values,
   * and trace data.
   */
  // deno-lint-ignore camelcase
  activate_and_trace(input: Float32Array, num_outputs: number): Float32Array;

  /**
   * Batch activate and trace for 4 records simultaneously.
   * Returns a packed Float32Array containing per-record lengths followed by
   * concatenated per-record data.
   */
  // deno-lint-ignore camelcase
  activate_and_trace_batch_4way(
    inputs: Float32Array,
    input_size: number,
    num_outputs: number,
  ): Float32Array;

  /**
   * Reset non-input activations to 0.0, restoring stateless behaviour.
   */
  // deno-lint-ignore camelcase
  reset_state(): void;

  /** Number of input neurons. */
  // deno-lint-ignore camelcase
  readonly num_inputs: number;

  /** Total number of neurons in the network. */
  // deno-lint-ignore camelcase
  readonly num_neurons: number;

  /** Total number of synapses in the network. */
  // deno-lint-ignore camelcase
  readonly num_synapses: number;
}

/**
 * Constructor type for creating `WasmCompiledNetwork` instances from
 * serialised data.
 */
export interface WasmCompiledNetworkConstructor {
  new (data: Uint8Array): WasmCompiledNetwork;
}

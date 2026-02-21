/**
 * TypeScript interface for the WASM PredictiveCodingEngine.
 *
 * Issue #1560: Provides type-safe access to the Rust/WASM predictive coding
 * inference engine without importing WASM-generated bindings directly.
 *
 * Property names use snake_case (quoted) to match the Rust-generated WASM
 * bindings exactly.
 */

/**
 * Interface describing the WASM PredictiveCodingEngine object.
 *
 * The engine is constructed from serialised topology data and provides
 * inference (settling) and gradient computation entry points.
 */
export interface WasmPredictiveCodingEngine {
  /** Release WASM-side memory. Safe to call multiple times. */
  free(): void;

  /** Disposable protocol for `using` declarations. */
  [Symbol.dispose](): void;

  /**
   * Run inference and return a packed result array.
   *
   * Result format (Float32Array):
   * - [0]: steps_used
   * - [1]: final_energy
   * - [2]: converged (1.0 = true, 0.0 = false)
   * - [3]: num_neurons
   * - [4]: num_non_inputs
   * - [5]: energy_history_length
   * - [6..6+num_neurons): latent values
   * - [6+num_neurons..6+num_neurons+num_non_inputs): predictions
   * - [6+num_neurons+num_non_inputs..6+num_neurons+2*num_non_inputs): errors
   * - [remaining]: energy history
   */
  // deno-lint-ignore camelcase
  infer_wasm(
    input: Float32Array,
    targets?: Float32Array,
  ): Float32Array;

  /**
   * Run inference on a batch of samples.
   *
   * Result format: packed with per-record length headers followed by
   * concatenated per-record data (each in infer_wasm format).
   */
  // deno-lint-ignore camelcase
  infer_batch_wasm(
    inputs: Float32Array,
    input_size: number,
    num_samples: number,
    targets?: Float32Array,
    target_size?: number,
  ): Float32Array;

  /**
   * Compute weight and bias gradients from settled inference state.
   *
   * Result format (Float32Array):
   * - [0]: num_non_inputs
   * - [1]: num_weight_entries
   * - [2..2+num_non_inputs): bias deltas
   * - [2+num_non_inputs..]: weight delta triples (neuron_idx, conn_idx, delta)
   */
  // deno-lint-ignore camelcase
  compute_gradients_wasm(
    latents: Float32Array,
    errors: Float32Array,
    learning_rate: number,
  ): Float32Array;

  /** Number of input neurons. */
  // deno-lint-ignore camelcase
  readonly num_inputs: number;

  /** Total number of neurons. */
  // deno-lint-ignore camelcase
  readonly num_neurons: number;

  /** Number of output neurons. */
  // deno-lint-ignore camelcase
  readonly num_outputs: number;
}

/**
 * Constructor type for creating `WasmPredictiveCodingEngine` instances.
 */
export interface WasmPredictiveCodingEngineConstructor {
  new (data: Uint8Array): WasmPredictiveCodingEngine;
}

/**
 * Parsed inference result from the packed WASM output.
 */
export interface WasmInferenceResult {
  /** Number of inference steps actually used. */
  stepsUsed: number;
  /** Total prediction error energy at convergence. */
  finalEnergy: number;
  /** Whether energy converged below the threshold. */
  converged: boolean;
  /** Final latent values for all neurons. */
  latents: Float32Array;
  /** Per-neuron predictions (for non-input neurons). */
  predictions: Float32Array;
  /** Per-neuron prediction errors (for non-input neurons). */
  errors: Float32Array;
  /** Energy at each iteration. */
  energyHistory: Float32Array;
}

/**
 * Parsed gradient result from the packed WASM output.
 */
export interface WasmGradientResult {
  /** Per-neuron bias deltas. */
  biasDeltas: Float32Array;
  /** Weight delta entries: [neuronRelIdx, connLocalIdx, delta]. */
  weightDeltas: Array<{ neuronIdx: number; connIdx: number; delta: number }>;
}

/**
 * Parses the packed Float32Array returned by `infer_wasm` into a
 * structured result.
 */
export function parseInferenceResult(
  packed: Float32Array,
): WasmInferenceResult {
  const stepsUsed = packed[0];
  const finalEnergy = packed[1];
  const converged = packed[2] === 1.0;
  const numNeurons = packed[3];
  const numNonInputs = packed[4];
  const energyHistoryLen = packed[5];

  const headerSize = 6;
  const latentStart = headerSize;
  const latentEnd = latentStart + numNeurons;
  const predStart = latentEnd;
  const predEnd = predStart + numNonInputs;
  const errStart = predEnd;
  const errEnd = errStart + numNonInputs;
  const histStart = errEnd;
  const histEnd = histStart + energyHistoryLen;

  return {
    stepsUsed,
    finalEnergy,
    converged,
    latents: packed.subarray(latentStart, latentEnd),
    predictions: packed.subarray(predStart, predEnd),
    errors: packed.subarray(errStart, errEnd),
    energyHistory: packed.subarray(histStart, histEnd),
  };
}

/**
 * Parses the packed Float32Array returned by `compute_gradients_wasm` into
 * a structured result.
 */
export function parseGradientResult(
  packed: Float32Array,
): WasmGradientResult {
  const numNonInputs = packed[0];
  const numWeightEntries = packed[1];

  const biasStart = 2;
  const biasEnd = biasStart + numNonInputs;
  const biasDeltas = packed.subarray(biasStart, biasEnd);

  const weightDeltas: Array<
    { neuronIdx: number; connIdx: number; delta: number }
  > = [];
  let offset = biasEnd;
  for (let i = 0; i < numWeightEntries; i++) {
    weightDeltas.push({
      neuronIdx: packed[offset],
      connIdx: packed[offset + 1],
      delta: packed[offset + 2],
    });
    offset += 3;
  }

  return { biasDeltas, weightDeltas };
}

/**
 * Serialises creature topology data for the PredictiveCodingEngine constructor.
 *
 * Binary format (all little-endian):
 * - u32: num_inputs
 * - u32: num_outputs
 * - u32: num_neurons_total
 * - u32: inference_steps
 * - f32: inference_rate
 * - f32: energy_threshold
 * - For each non-input neuron:
 *   - f32: bias
 *   - u8: squash_type
 *   - u8: is_hidden (1 = hidden, 0 = output)
 *   - u16: num_connections
 *   - For each connection:
 *     - u16: from_index
 *     - f32: weight
 */
export function serialisePcTopology(
  numInputs: number,
  numOutputs: number,
  numNeuronsTotal: number,
  inferenceSteps: number,
  inferenceRate: number,
  energyThreshold: number,
  neurons: Array<{
    bias: number;
    squashType: number;
    isHidden: boolean;
    connections: Array<{ from: number; weight: number }>;
  }>,
): Uint8Array {
  // Estimate buffer size: header (24) + neurons * (8 + conns * 6)
  const totalConns = neurons.reduce(
    (sum, n) => sum + n.connections.length,
    0,
  );
  const size = 24 + neurons.length * 8 + totalConns * 6;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, numInputs, true);
  offset += 4;
  view.setUint32(offset, numOutputs, true);
  offset += 4;
  view.setUint32(offset, numNeuronsTotal, true);
  offset += 4;
  view.setUint32(offset, inferenceSteps, true);
  offset += 4;
  view.setFloat32(offset, inferenceRate, true);
  offset += 4;
  view.setFloat32(offset, energyThreshold, true);
  offset += 4;

  // Neurons
  for (const neuron of neurons) {
    view.setFloat32(offset, neuron.bias, true);
    offset += 4;
    view.setUint8(offset, neuron.squashType);
    offset += 1;
    view.setUint8(offset, neuron.isHidden ? 1 : 0);
    offset += 1;
    view.setUint16(offset, neuron.connections.length, true);
    offset += 2;

    for (const conn of neuron.connections) {
      view.setUint16(offset, conn.from, true);
      offset += 2;
      view.setFloat32(offset, conn.weight, true);
      offset += 4;
    }
  }

  return new Uint8Array(buffer, 0, offset);
}

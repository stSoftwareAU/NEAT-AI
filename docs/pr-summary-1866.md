## Summary

Add ONNX format export for NEAT-AI creature models, enabling deployment in
standard ML pipelines. Closes #1866.

The implementation maps NEAT creature topology (neurons, synapses, activation
functions) to an ONNX computational graph that produces identical outputs for
the same inputs.

### Key features:

- **Standard activations** (Sigmoid, Tanh, ReLU, etc.) map directly to ONNX
  operators
- **Composed activations** (GELU, Swish, ISRU, etc.) are built from standard
  ONNX operators
- **Aggregate activations** (IF, MAXIMUM, MINIMUM) receive special graph
  handling
- **Validation function** verifies ONNX export matches original creature outputs
- **No external dependencies** — protobuf encoding is implemented natively

### Architecture:

- `src/onnx/OnnxProtobuf.ts` — Minimal ONNX protobuf encoder (wire-format only)
- `src/onnx/ActivationMapping.ts` — Maps NEAT squash functions to ONNX operators
- `src/onnx/OnnxExport.ts` — Main export logic: graph building, neuron
  processing, validation
- `src/onnx/mod.ts` — Public module entry point

## Evidence

- 18 unit tests verify activation mapping, export byte generation, and output
  equivalence
- `validateOnnxExport()` confirms ONNX graph produces identical outputs to the
  original creature
- Tests cover standard activations, composed activations, multiple outputs, and
  edge cases

## Test Plan

- `test/onnx/OnnxExport.ts` — 18 tests covering:
  - Activation mapping correctness (standard, composed, aggregate, unknown)
  - `findUnsupportedActivations` identifies unsupported squashes
  - `exportToOnnx` produces valid protobuf bytes with correct structure
  - Custom export options (model name, producer name/version)
  - Unsupported activation rejection
  - Direct `CreatureExport` JSON input support
  - Output validation for TANH, ReLU, LOGISTIC, ELU, SELU, SOFTSIGN, Softplus,
    IDENTITY
  - Manually constructed creature with known weights
  - Multiple output neurons
  - File write/read round-trip

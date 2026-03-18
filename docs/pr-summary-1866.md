## Summary

Implements ONNX format export for NEAT-AI creature models, allowing trained
creatures to be deployed in standard ML pipelines. Closes #1866.

The implementation maps NEAT creature topology (neurons, synapses, activation
functions) to ONNX computational graphs:

- **Protobuf encoder** (`src/onnx/ProtobufEncoder.ts`): Minimal Protocol Buffers
  wire format encoder for producing valid ONNX binary files without external
  dependencies.
- **Activation mapping** (`src/onnx/ActivationMapping.ts`): Maps all 32 standard
  NEAT activation functions to ONNX operators. Simple activations (sigmoid,
  tanh, ReLU) map directly; composite activations (Swish, Mish, GELU,
  BENT_IDENTITY, etc.) are built from multiple ONNX operators.
- **ONNX export** (`src/onnx/OnnxExport.ts`): Converts creature topology to an
  ONNX graph where each neuron becomes weighted-sum + bias + activation nodes.
  Includes compatibility checking for unsupported aggregate functions (IF,
  MINIMUM, MAXIMUM).
- **Public API** (`mod.ts`): Exports `exportToOnnx`, `checkOnnxCompatibility`,
  and `isSquashSupported`.

### Documented limitations

- Aggregate functions (IF, MINIMUM, MAXIMUM) are not supported and will be
  rejected with a clear error message
- Deprecated functions (HYPOT, HYPOTv2, MEAN) are not supported
- BIPOLAR activation maps to ONNX Sign operator (slight difference at x=0)

## Evidence

All 27 new tests pass successfully:

- 13 protobuf encoder tests verifying varint, float, string, and message
  encoding
- 14 ONNX export tests covering simple creatures, hidden layers, multi-layer
  networks, constant neurons, multiple outputs, all 32 supported activation
  functions, compatibility checking, aggregate function rejection, and protobuf
  header validation

## Test Plan

- `test/onnx/ProtobufEncoder.ts` — 13 tests for the protobuf wire format encoder
- `test/onnx/OnnxExport.ts` — 14 tests for ONNX export including:
  - Simple creature export produces valid bytes
  - Hidden layer creatures export correctly
  - Aggregate functions (IF) are rejected with error
  - Compatibility checker identifies unsupported squashes
  - All 32 standard activations export successfully
  - Custom graph names, multiple outputs, multi-layer networks
  - Protobuf header contains correct ir_version
  - Constant neuron handling
  - Producer name embedded in output

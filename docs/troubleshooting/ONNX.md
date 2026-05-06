# 📤 ONNX Export Troubleshooting

This document covers ONNX (Open Neural Network Exchange) export issues:
unsupported squashes detected by `checkOnnxCompatibility`, and small numerical
differences between NEAT-AI's WASM (WebAssembly) activation and standard ONNX
runtimes. See the index in [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) for
other categories.

## `checkOnnxCompatibility` reports unsupported squashes

The ONNX format does not support NEAT-AI's aggregate functions (IF, MINIMUM,
MAXIMUM) or deprecated functions (HYPOT, HYPOTv2, MEAN). If your creature uses
these, consider:

- Running **Intelligent Design** with restricted squash lists that exclude
  unsupported functions
- Retraining with `activations` limited to ONNX-compatible functions (e.g. TANH,
  SIGMOID, RELU, LOGISTIC)

## Exported ONNX model produces different outputs

Small floating-point differences (< 1e-10) are expected due to different
computation order and precision between the WASM-based activation in NEAT-AI and
standard ONNX runtimes. If differences are larger, check for recurrent
connections — ONNX export does not support feedback loops.

## See also

- [Activation functions](../ACTIVATION_FUNCTIONS.md) — selection guide
  highlighting ONNX-compatible options.
- [Intelligent Design](../INTELLIGENT_DESIGN.md) — systematic per-neuron squash
  optimisation.

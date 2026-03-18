/**
 * Maps NEAT activation functions to ONNX operator representations.
 *
 * Issue #1866: Standard activations (sigmoid, tanh, ReLU, etc.) map directly
 * to ONNX operators. Custom/composite activations are built from multiple
 * ONNX operators. Aggregate functions (IF, MINIMUM, MAXIMUM) require
 * special handling at the neuron level.
 *
 * Constants used by composite activations are referenced by conventional
 * names (e.g. "const_1", "const_0.5") and must be provided as graph
 * initialisers by the caller.
 *
 * Uses Australian English spelling throughout.
 */

import type { OnnxAttribute, OnnxNode } from "./OnnxModel.ts";
import { OnnxAttributeType } from "./OnnxModel.ts";

/** Result of mapping an activation: one or more ONNX nodes. */
export interface ActivationMapping {
  /** The ONNX nodes that implement this activation. */
  nodes: OnnxNode[];
  /** The name of the final output tensor. */
  outputName: string;
  /** Names of constant tensors required (e.g. "const_1", "const_0.5"). */
  requiredConstants: string[];
}

/** Aggregate functions that need special neuron-level handling. */
const AGGREGATE_FUNCTIONS = new Set(["IF", "MINIMUM", "MAXIMUM"]);

/** Deprecated functions that cannot be exported. */
const DEPRECATED_FUNCTIONS = new Set(["HYPOT", "HYPOTv2", "MEAN"]);

/**
 * Whether a given squash function is supported for ONNX export.
 * Aggregate and deprecated functions are not supported.
 */
export function isSquashSupported(squash: string): boolean {
  if (AGGREGATE_FUNCTIONS.has(squash) || DEPRECATED_FUNCTIONS.has(squash)) {
    return false;
  }
  return SQUASH_TO_ONNX_MAPPING.has(squash);
}

/**
 * Whether a squash function is an aggregate function requiring
 * special neuron-level handling.
 */
export function isAggregateFunction(squash: string): boolean {
  return AGGREGATE_FUNCTIONS.has(squash);
}

/**
 * Build ONNX nodes for a given activation function applied to an input tensor.
 *
 * @param squash - The NEAT activation function name
 * @param inputName - The name of the input tensor (pre-activation value)
 * @param outputName - The desired name of the output tensor
 * @param nodePrefix - Prefix for intermediate node names (for uniqueness)
 * @returns The list of ONNX nodes implementing the activation
 */
export function buildActivationNodes(
  squash: string,
  inputName: string,
  outputName: string,
  nodePrefix: string,
): ActivationMapping {
  const mapper = SQUASH_TO_ONNX_MAPPING.get(squash);
  if (!mapper) {
    throw new Error(
      `Unsupported activation function for ONNX export: ${squash}`,
    );
  }
  return mapper(inputName, outputName, nodePrefix);
}

// Helper to create a simple single-op activation node
function simpleOp(
  opType: string,
  attrs?: OnnxAttribute[],
): ActivationMapper {
  return (inputName, outputName, nodePrefix) => ({
    nodes: [{
      inputs: [inputName],
      outputs: [outputName],
      name: `${nodePrefix}_${opType}`,
      opType,
      attributes: attrs,
    }],
    outputName,
    requiredConstants: [],
  });
}

type ActivationMapper = (
  inputName: string,
  outputName: string,
  nodePrefix: string,
) => ActivationMapping;

/**
 * Mapping from NEAT squash names to ONNX node builders.
 * Each entry produces one or more ONNX nodes that implement
 * the activation function.
 */
const SQUASH_TO_ONNX_MAPPING: Map<string, ActivationMapper> = new Map([
  // === Direct ONNX operator mappings ===
  ["IDENTITY", simpleOp("Identity")],
  ["ReLU", simpleOp("Relu")],
  ["LOGISTIC", simpleOp("Sigmoid")],
  ["TANH", simpleOp("Tanh")],
  [
    "LeakyReLU",
    simpleOp("LeakyRelu", [{
      name: "alpha",
      type: OnnxAttributeType.FLOAT,
      f: 0.01,
    }]),
  ],
  ["SELU", simpleOp("Selu")],
  ["ELU", simpleOp("Elu")],
  ["SOFTSIGN", simpleOp("Softsign")],
  ["Softplus", simpleOp("Softplus")],
  ["SINE", simpleOp("Sin")],
  ["Cosine", simpleOp("Cos")],
  ["TAN", simpleOp("Tan")],
  ["ArcTan", simpleOp("Atan")],
  ["ABSOLUTE", simpleOp("Abs")],
  ["SQRT", simpleOp("Sqrt")],
  ["Exponential", simpleOp("Exp")],
  ["StdInverse", simpleOp("Reciprocal")],

  // ReLU6: Clip(x, min=0, max=6)
  [
    "ReLU6",
    simpleOp("Clip", [
      { name: "min", type: OnnxAttributeType.FLOAT, f: 0.0 },
      { name: "max", type: OnnxAttributeType.FLOAT, f: 6.0 },
    ]),
  ],

  // HARD_TANH: Clip(x, min=-1, max=1)
  [
    "HARD_TANH",
    simpleOp("Clip", [
      { name: "min", type: OnnxAttributeType.FLOAT, f: -1.0 },
      { name: "max", type: OnnxAttributeType.FLOAT, f: 1.0 },
    ]),
  ],

  // === STEP: x > 0 ? 1 : 0 → Relu(Sign(x)) ===
  ["STEP", (inputName, outputName, nodePrefix) => {
    const signOut = `${nodePrefix}_sign`;
    return {
      nodes: [
        {
          inputs: [inputName],
          outputs: [signOut],
          name: `${nodePrefix}_Sign`,
          opType: "Sign",
        },
        {
          inputs: [signOut],
          outputs: [outputName],
          name: `${nodePrefix}_Relu`,
          opType: "Relu",
        },
      ],
      outputName,
      requiredConstants: [],
    };
  }],

  // === BIPOLAR: x > 0 ? 1 : -1 → Sign(x) ===
  // Note: Sign(0) = 0, but BIPOLAR(0) = -1. This is a close approximation.
  ["BIPOLAR", simpleOp("Sign")],

  // === Composite activations built from multiple ONNX ops ===

  // Swish: x * sigmoid(x)
  ["Swish", (inputName, outputName, nodePrefix) => {
    const sigOut = `${nodePrefix}_sig`;
    return {
      nodes: [
        {
          inputs: [inputName],
          outputs: [sigOut],
          name: `${nodePrefix}_Sigmoid`,
          opType: "Sigmoid",
        },
        {
          inputs: [inputName, sigOut],
          outputs: [outputName],
          name: `${nodePrefix}_Mul`,
          opType: "Mul",
        },
      ],
      outputName,
      requiredConstants: [],
    };
  }],

  // Mish: x * tanh(softplus(x))
  ["Mish", (inputName, outputName, nodePrefix) => {
    const spOut = `${nodePrefix}_sp`;
    const tanhOut = `${nodePrefix}_tanh`;
    return {
      nodes: [
        {
          inputs: [inputName],
          outputs: [spOut],
          name: `${nodePrefix}_Softplus`,
          opType: "Softplus",
        },
        {
          inputs: [spOut],
          outputs: [tanhOut],
          name: `${nodePrefix}_Tanh`,
          opType: "Tanh",
        },
        {
          inputs: [inputName, tanhOut],
          outputs: [outputName],
          name: `${nodePrefix}_Mul`,
          opType: "Mul",
        },
      ],
      outputName,
      requiredConstants: [],
    };
  }],

  // GELU approximation: x * sigmoid(1.702 * x)
  ["GELU", (inputName, outputName, nodePrefix) => {
    const scaleConst = "const_1.702";
    const scaledOut = `${nodePrefix}_scaled`;
    const sigOut = `${nodePrefix}_sig`;
    return {
      nodes: [
        {
          inputs: [inputName, scaleConst],
          outputs: [scaledOut],
          name: `${nodePrefix}_Scale`,
          opType: "Mul",
        },
        {
          inputs: [scaledOut],
          outputs: [sigOut],
          name: `${nodePrefix}_Sigmoid`,
          opType: "Sigmoid",
        },
        {
          inputs: [inputName, sigOut],
          outputs: [outputName],
          name: `${nodePrefix}_Mul`,
          opType: "Mul",
        },
      ],
      outputName,
      requiredConstants: [scaleConst],
    };
  }],

  // GAUSSIAN: exp(-x^2)
  ["GAUSSIAN", (inputName, outputName, nodePrefix) => {
    const sqOut = `${nodePrefix}_sq`;
    const negOut = `${nodePrefix}_neg`;
    return {
      nodes: [
        {
          inputs: [inputName, inputName],
          outputs: [sqOut],
          name: `${nodePrefix}_Square`,
          opType: "Mul",
        },
        {
          inputs: [sqOut],
          outputs: [negOut],
          name: `${nodePrefix}_Neg`,
          opType: "Neg",
        },
        {
          inputs: [negOut],
          outputs: [outputName],
          name: `${nodePrefix}_Exp`,
          opType: "Exp",
        },
      ],
      outputName,
      requiredConstants: [],
    };
  }],

  // BIPOLAR_SIGMOID: 2 * sigmoid(x) - 1
  ["BIPOLAR_SIGMOID", (inputName, outputName, nodePrefix) => {
    const sigOut = `${nodePrefix}_sig`;
    const scaledOut = `${nodePrefix}_scaled`;
    return {
      nodes: [
        {
          inputs: [inputName],
          outputs: [sigOut],
          name: `${nodePrefix}_Sigmoid`,
          opType: "Sigmoid",
        },
        {
          inputs: [sigOut, "const_2"],
          outputs: [scaledOut],
          name: `${nodePrefix}_Mul`,
          opType: "Mul",
        },
        {
          inputs: [scaledOut, "const_1"],
          outputs: [outputName],
          name: `${nodePrefix}_Sub`,
          opType: "Sub",
        },
      ],
      outputName,
      requiredConstants: ["const_2", "const_1"],
    };
  }],

  // COMPLEMENT: 1 - x
  ["COMPLEMENT", (inputName, outputName, nodePrefix) => ({
    nodes: [{
      inputs: ["const_1", inputName],
      outputs: [outputName],
      name: `${nodePrefix}_Sub`,
      opType: "Sub",
    }],
    outputName,
    requiredConstants: ["const_1"],
  })],

  // SQUARE: x * x
  ["SQUARE", (inputName, outputName, nodePrefix) => ({
    nodes: [{
      inputs: [inputName, inputName],
      outputs: [outputName],
      name: `${nodePrefix}_Mul`,
      opType: "Mul",
    }],
    outputName,
    requiredConstants: [],
  })],

  // Cube: x * x * x
  ["Cube", (inputName, outputName, nodePrefix) => {
    const sqOut = `${nodePrefix}_sq`;
    return {
      nodes: [
        {
          inputs: [inputName, inputName],
          outputs: [sqOut],
          name: `${nodePrefix}_Sq`,
          opType: "Mul",
        },
        {
          inputs: [sqOut, inputName],
          outputs: [outputName],
          name: `${nodePrefix}_Cube`,
          opType: "Mul",
        },
      ],
      outputName,
      requiredConstants: [],
    };
  }],

  // LogSigmoid: log(sigmoid(x))
  ["LogSigmoid", (inputName, outputName, nodePrefix) => {
    const sigOut = `${nodePrefix}_sig`;
    return {
      nodes: [
        {
          inputs: [inputName],
          outputs: [sigOut],
          name: `${nodePrefix}_Sigmoid`,
          opType: "Sigmoid",
        },
        {
          inputs: [sigOut],
          outputs: [outputName],
          name: `${nodePrefix}_Log`,
          opType: "Log",
        },
      ],
      outputName,
      requiredConstants: [],
    };
  }],

  // ISRU: x / sqrt(1 + x^2)
  ["ISRU", (inputName, outputName, nodePrefix) => {
    const sqOut = `${nodePrefix}_sq`;
    const addOut = `${nodePrefix}_add`;
    const sqrtOut = `${nodePrefix}_sqrt`;
    return {
      nodes: [
        {
          inputs: [inputName, inputName],
          outputs: [sqOut],
          name: `${nodePrefix}_Square`,
          opType: "Mul",
        },
        {
          inputs: ["const_1", sqOut],
          outputs: [addOut],
          name: `${nodePrefix}_Add`,
          opType: "Add",
        },
        {
          inputs: [addOut],
          outputs: [sqrtOut],
          name: `${nodePrefix}_Sqrt`,
          opType: "Sqrt",
        },
        {
          inputs: [inputName, sqrtOut],
          outputs: [outputName],
          name: `${nodePrefix}_Div`,
          opType: "Div",
        },
      ],
      outputName,
      requiredConstants: ["const_1"],
    };
  }],

  // BENT_IDENTITY: (sqrt(x^2 + 1) - 1)/2 + x
  ["BENT_IDENTITY", (inputName, outputName, nodePrefix) => {
    const sqOut = `${nodePrefix}_sq`;
    const addOut = `${nodePrefix}_add`;
    const sqrtOut = `${nodePrefix}_sqrt`;
    const subOut = `${nodePrefix}_sub`;
    const halfOut = `${nodePrefix}_half`;
    return {
      nodes: [
        {
          inputs: [inputName, inputName],
          outputs: [sqOut],
          name: `${nodePrefix}_Square`,
          opType: "Mul",
        },
        {
          inputs: [sqOut, "const_1"],
          outputs: [addOut],
          name: `${nodePrefix}_Add1`,
          opType: "Add",
        },
        {
          inputs: [addOut],
          outputs: [sqrtOut],
          name: `${nodePrefix}_Sqrt`,
          opType: "Sqrt",
        },
        {
          inputs: [sqrtOut, "const_1"],
          outputs: [subOut],
          name: `${nodePrefix}_Sub`,
          opType: "Sub",
        },
        {
          inputs: [subOut, "const_0.5"],
          outputs: [halfOut],
          name: `${nodePrefix}_Half`,
          opType: "Mul",
        },
        {
          inputs: [halfOut, inputName],
          outputs: [outputName],
          name: `${nodePrefix}_AddX`,
          opType: "Add",
        },
      ],
      outputName,
      requiredConstants: ["const_1", "const_0.5"],
    };
  }],
]);

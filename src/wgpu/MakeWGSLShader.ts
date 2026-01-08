import type { Creature } from "../Creature.ts";
import type { Neuron } from "../architecture/Neuron.ts";
import type { Synapse } from "../architecture/Synapse.ts";

/**
 * Maps activation function names to their WGSL implementations.
 * WGSL doesn't have all Math functions, so we provide implementations.
 */
const WGSL_SQUASH_FUNCTIONS: Record<string, string> = {
  ReLU: `
fn squash_ReLU(x: f32) -> f32 {
  return max(0.0, x);
}`,
  LeakyReLU: `
fn squash_LeakyReLU(x: f32) -> f32 {
  return select(0.01 * x, x, x > 0.0);
}`,
  TANH: `
fn squash_TANH(x: f32) -> f32 {
  return tanh(x);
}`,
  LOGISTIC: `
fn squash_LOGISTIC(x: f32) -> f32 {
  return 1.0 / (1.0 + exp(-x));
}`,
  IDENTITY: `
fn squash_IDENTITY(x: f32) -> f32 {
  return x;
}`,
  STEP: `
fn squash_STEP(x: f32) -> f32 {
  return select(0.0, 1.0, x > 0.0);
}`,
  BIPOLAR: `
fn squash_BIPOLAR(x: f32) -> f32 {
  return select(-1.0, 1.0, x > 0.0);
}`,
  BIPOLAR_SIGMOID: `
fn squash_BIPOLAR_SIGMOID(x: f32) -> f32 {
  return 2.0 / (1.0 + exp(-x)) - 1.0;
}`,
  HARD_TANH: `
fn squash_HARD_TANH(x: f32) -> f32 {
  return clamp(x, -1.0, 1.0);
}`,
  ABSOLUTE: `
fn squash_ABSOLUTE(x: f32) -> f32 {
  return abs(x);
}`,
  COMPLEMENT: `
fn squash_COMPLEMENT(x: f32) -> f32 {
  return 1.0 - x;
}`,
  BENT_IDENTITY: `
fn squash_BENT_IDENTITY(x: f32) -> f32 {
  return (sqrt(x * x + 1.0) - 1.0) / 2.0 + x;
}`,
  SINE: `
fn squash_SINE(x: f32) -> f32 {
  return sin(x);
}`,
  Cosine: `
fn squash_Cosine(x: f32) -> f32 {
  return cos(x);
}`,
  SOFTSIGN: `
fn squash_SOFTSIGN(x: f32) -> f32 {
  return x / (1.0 + abs(x));
}`,
  Softplus: `
fn squash_Softplus(x: f32) -> f32 {
  return log(1.0 + exp(x));
}`,
  GAUSSIAN: `
fn squash_GAUSSIAN(x: f32) -> f32 {
  return exp(-x * x);
}`,
  ELU: `
fn squash_ELU(x: f32) -> f32 {
  return select(exp(x) - 1.0, x, x >= 0.0);
}`,
  SELU: `
fn squash_SELU(x: f32) -> f32 {
  let alpha = 1.6732632423543772;
  let scale = 1.0507009873554805;
  return scale * select(alpha * (exp(x) - 1.0), x, x >= 0.0);
}`,
  ReLU6: `
fn squash_ReLU6(x: f32) -> f32 {
  return clamp(x, 0.0, 6.0);
}`,
  Swish: `
fn squash_Swish(x: f32) -> f32 {
  return x / (1.0 + exp(-x));
}`,
  Mish: `
fn squash_Mish(x: f32) -> f32 {
  let sp = log(1.0 + exp(x));
  return x * tanh(sp);
}`,
  GELU: `
fn squash_GELU(x: f32) -> f32 {
  return 0.5 * x * (1.0 + tanh(sqrt(2.0 / 3.14159265359) * (x + 0.044715 * x * x * x)));
}`,
  SQUARE: `
fn squash_SQUARE(x: f32) -> f32 {
  return x * x;
}`,
  SQRT: `
fn squash_SQRT(x: f32) -> f32 {
  return sqrt(abs(x));
}`,
  Cube: `
fn squash_Cube(x: f32) -> f32 {
  return x * x * x;
}`,
  Exponential: `
fn squash_Exponential(x: f32) -> f32 {
  return exp(x);
}`,
  TAN: `
fn squash_TAN(x: f32) -> f32 {
  return tan(clamp(x, -1.5, 1.5));
}`,
  ArcTan: `
fn squash_ArcTan(x: f32) -> f32 {
  return atan(x);
}`,
  LogSigmoid: `
fn squash_LogSigmoid(x: f32) -> f32 {
  return -log(1.0 + exp(-x));
}`,
  ISRU: `
fn squash_ISRU(x: f32) -> f32 {
  return x / sqrt(1.0 + x * x);
}`,
  StdInverse: `
fn squash_StdInverse(x: f32) -> f32 {
  return 1.0 / (1.0 + abs(x));
}`,
};

/**
 * Information about a neuron needed for shader generation
 */
interface NeuronInfo {
  index: number;
  type: string;
  bias: number;
  squash: string;
  inwardConnections: { from: number; weight: number }[];
}

/**
 * Result of WGSL shader generation
 */
export interface WGSLShaderResult {
  /** The complete WGSL shader code */
  shaderCode: string;
  /** Number of neurons in the network */
  neuronCount: number;
  /** Number of input neurons */
  inputCount: number;
  /** Number of output neurons */
  outputCount: number;
  /** Set of squash function names used */
  squashFunctions: Set<string>;
}

/**
 * Generates WGSL compute shader code for batched creature activation.
 *
 * The shader processes multiple input records in parallel on the GPU.
 * Each workgroup thread handles one complete forward pass through the network.
 *
 * Memory layout:
 * - inputs: [batch_size * input_count] f32 values, row-major
 * - outputs: [batch_size * output_count] f32 values, row-major
 * - activations: [batch_size * neuron_count] f32 values for intermediate results
 */
export function makeWGSLShader(creature: Creature): WGSLShaderResult {
  const neurons = creature.neurons;
  const inputCount = creature.input;
  const outputCount = creature.output;
  const neuronCount = neurons.length;

  // Collect neuron information
  const neuronInfos: NeuronInfo[] = [];
  const usedSquashFunctions = new Set<string>();

  for (let i = 0; i < neuronCount; i++) {
    const neuron = neurons[i];
    const info: NeuronInfo = {
      index: neuron.index,
      type: neuron.type,
      bias: neuron.bias,
      squash: neuron.squash ?? "IDENTITY",
      inwardConnections: [],
    };

    if (i >= inputCount) {
      const inward = creature.inwardConnections(i);
      for (const synapse of inward) {
        info.inwardConnections.push({
          from: synapse.from,
          weight: synapse.weight,
        });
      }
      if (info.type !== "constant") {
        usedSquashFunctions.add(info.squash);
      }
    }

    neuronInfos.push(info);
  }

  // Generate shader code
  const shaderParts: string[] = [];

  // Header and bindings
  shaderParts.push(`// Auto-generated WGSL shader for creature activation
// Neurons: ${neuronCount}, Inputs: ${inputCount}, Outputs: ${outputCount}

struct Params {
  batch_size: u32,
  input_count: u32,
  output_count: u32,
  neuron_count: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputs: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputs: array<f32>;
`);

  // Add required squash functions
  for (const squashName of usedSquashFunctions) {
    const squashCode = WGSL_SQUASH_FUNCTIONS[squashName];
    if (squashCode) {
      shaderParts.push(squashCode);
    } else {
      // Fallback to identity if unknown
      shaderParts.push(`
fn squash_${squashName}(x: f32) -> f32 {
  return x; // Unknown squash, using identity
}`);
    }
  }

  // Generate the compute kernel
  shaderParts.push(`

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let batch_idx = global_id.x;
  if (batch_idx >= params.batch_size) {
    return;
  }

  // Local activation array for this batch item
  var a: array<f32, ${neuronCount}>;

  // Copy inputs to activation array
  let input_offset = batch_idx * params.input_count;
  for (var i: u32 = 0u; i < params.input_count; i = i + 1u) {
    a[i] = inputs[input_offset + i];
  }
`);

  // Generate activation code for each hidden and output neuron
  for (let i = inputCount; i < neuronCount; i++) {
    const info = neuronInfos[i];
    const activationCode = generateNeuronActivation(info, neuronInfos);
    shaderParts.push(activationCode);
  }

  // Copy outputs
  const firstOutputIndex = neuronCount - outputCount;
  shaderParts.push(`
  // Copy outputs
  let output_offset = batch_idx * params.output_count;
  for (var o: u32 = 0u; o < params.output_count; o = o + 1u) {
    outputs[output_offset + o] = a[${firstOutputIndex}u + o];
  }
}
`);

  return {
    shaderCode: shaderParts.join("\n"),
    neuronCount,
    inputCount,
    outputCount,
    squashFunctions: usedSquashFunctions,
  };
}

/**
 * Generates WGSL code for a single neuron's activation
 */
function generateNeuronActivation(
  neuron: NeuronInfo,
  _allNeurons: NeuronInfo[],
): string {
  const idx = neuron.index;

  // Constant neurons just output their bias
  if (neuron.type === "constant") {
    return `  a[${idx}] = ${formatFloat(neuron.bias)};`;
  }

  // Build the weighted sum expression
  const terms: string[] = [];

  // Add bias if non-zero or if there are no connections
  if (neuron.bias !== 0 || neuron.inwardConnections.length === 0) {
    terms.push(formatFloat(neuron.bias));
  }

  // Add weighted inputs
  for (const conn of neuron.inwardConnections) {
    if (conn.weight === 1) {
      terms.push(`a[${conn.from}]`);
    } else if (conn.weight === -1) {
      terms.push(`-a[${conn.from}]`);
    } else {
      terms.push(`a[${conn.from}] * ${formatFloat(conn.weight)}`);
    }
  }

  const sumExpr = terms.length > 0 ? terms.join(" + ") : "0.0";

  // Apply squash function
  if (neuron.squash === "ReLU") {
    // Inline ReLU for performance
    return `  { let t = ${sumExpr}; a[${idx}] = max(0.0, t); }`;
  } else if (neuron.squash === "IDENTITY") {
    return `  a[${idx}] = ${sumExpr};`;
  } else {
    return `  a[${idx}] = squash_${neuron.squash}(${sumExpr});`;
  }
}

/**
 * Formats a number as a WGSL float literal
 */
function formatFloat(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}.0`;
  }
  return value.toString();
}

/**
 * Generates synapse value expression similar to JS version
 */
export function makeSynapsesValueWGSL(
  synapse: Synapse,
  neurons: Neuron[],
): string {
  const { from, weight } = synapse;
  const fromNeuron = neurons[from];

  if (fromNeuron.type === "constant") {
    const value = fromNeuron.bias * weight;
    return formatFloat(value);
  } else if (weight === 1) {
    return `a[${from}]`;
  } else if (weight === -1) {
    return `-a[${from}]`;
  } else {
    return `a[${from}] * ${formatFloat(weight)}`;
  }
}

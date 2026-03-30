/**
 * Export a NEAT creature to ONNX format.
 *
 * Issue #1866: Converts a creature's neurons, synapses, and activation
 * functions into an ONNX computational graph. The exported model produces
 * identical outputs to the original creature for the same inputs
 * (within floating-point precision).
 *
 * Limitations:
 * - Aggregate functions (IF, MINIMUM, MAXIMUM) are not supported
 * - Deprecated functions (HYPOT, HYPOTv2, MEAN) are not supported
 * - Recurrent connections (feedback loops) are not supported
 *
 * Uses Australian English spelling throughout.
 */

import type { Creature } from "@creature";
import {
  buildActivationNodes,
  isAggregateFunction,
  isSquashSupported,
} from "@onnx/ActivationMapping.ts";
import {
  createOnnxModel,
  encodeOnnxModel,
  OnnxDataType,
  type OnnxGraph,
  type OnnxNode,
  type OnnxTensor,
  type OnnxValueInfo,
} from "@onnx/OnnxModel.ts";

/** Options for ONNX export. */
export interface OnnxExportOptions {
  /** Name for the ONNX graph. Defaults to "neat_creature". */
  graphName?: string;
}

/** Result of checking a creature's ONNX export compatibility. */
export interface OnnxCompatibilityResult {
  /** Whether the creature can be exported to ONNX. */
  compatible: boolean;
  /** List of unsupported squash functions found in the creature. */
  unsupportedSquashes: string[];
}

/**
 * Check whether a creature can be exported to ONNX format.
 *
 * @param creature - The creature to check
 * @returns Compatibility result with details on any unsupported features
 */
export function checkOnnxCompatibility(
  creature: Creature,
): OnnxCompatibilityResult {
  const unsupportedSquashes: string[] = [];

  for (let i = creature.input; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    if (neuron.type === "constant") continue;
    const squash = neuron.squash;
    if (!squash) continue;

    if (isAggregateFunction(squash) || !isSquashSupported(squash)) {
      if (!unsupportedSquashes.includes(squash)) {
        unsupportedSquashes.push(squash);
      }
    }
  }

  return {
    compatible: unsupportedSquashes.length === 0,
    unsupportedSquashes,
  };
}

/**
 * Export a NEAT creature to ONNX binary format.
 *
 * The creature's topology is converted into an ONNX computational graph
 * where each neuron becomes a series of ONNX operations:
 * 1. Weighted sum of incoming connections
 * 2. Bias addition
 * 3. Activation function application
 *
 * @param creature - The trained creature to export
 * @param options - Export options
 * @returns The ONNX model as a Uint8Array (binary protobuf)
 * @throws Error if the creature contains unsupported activation functions
 */
export function exportToOnnx(
  creature: Creature,
  options?: OnnxExportOptions,
): Uint8Array {
  const compatibility = checkOnnxCompatibility(creature);
  if (!compatibility.compatible) {
    throw new Error(
      `Creature contains unsupported activation functions for ONNX export: ${
        compatibility.unsupportedSquashes.join(", ")
      }`,
    );
  }

  const graphName = options?.graphName ?? "neat_creature";
  const graph = buildOnnxGraph(creature, graphName);
  const model = createOnnxModel(graph);
  return encodeOnnxModel(model);
}

/**
 * Build an ONNX graph from a creature's topology.
 */
function buildOnnxGraph(creature: Creature, graphName: string): OnnxGraph {
  const nodes: OnnxNode[] = [];
  const initialisers: OnnxTensor[] = [];
  const requiredConstants = new Set<string>();
  const inputCount = creature.input;

  /** Get the tensor name for a neuron at the given index. */
  const tn = (index: number): string => {
    if (index < inputCount) return `input_${index}`;
    return `neuron_${index}`;
  };

  // Graph inputs: one scalar per input neuron
  const inputs: OnnxValueInfo[] = [];
  for (let i = 0; i < inputCount; i++) {
    inputs.push({
      name: tn(i),
      elemType: OnnxDataType.FLOAT,
      shape: [{ dimValue: 1 }],
    });
  }

  // Process each non-input neuron in order
  for (let i = inputCount; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];

    if (neuron.type === "constant") {
      // Constant neurons output their bias value
      initialisers.push({
        name: tn(i),
        dataType: OnnxDataType.FLOAT,
        dims: [1],
        floatData: [neuron.bias],
      });
      continue;
    }

    const inwardSynapses = creature.inwardConnections(i);
    const neuronPrefix = `n${i}`;

    if (inwardSynapses.length === 0) {
      // No incoming connections — output is just the bias
      initialisers.push({
        name: tn(i),
        dataType: OnnxDataType.FLOAT,
        dims: [1],
        floatData: [neuron.bias],
      });
      continue;
    }

    // Step 1: Weighted sum of inputs
    const weightedInputs: string[] = [];

    for (let j = 0; j < inwardSynapses.length; j++) {
      const synapse = inwardSynapses[j];
      const weightName = `${neuronPrefix}_w${j}`;
      const mulOutput = `${neuronPrefix}_mul${j}`;

      // Add weight as initialiser
      initialisers.push({
        name: weightName,
        dataType: OnnxDataType.FLOAT,
        dims: [1],
        floatData: [synapse.weight],
      });

      // Multiply source activation by weight
      nodes.push({
        inputs: [tn(synapse.from), weightName],
        outputs: [mulOutput],
        name: `${neuronPrefix}_Mul${j}`,
        opType: "Mul",
      });

      weightedInputs.push(mulOutput);
    }

    // Sum all weighted inputs
    let sumOutput: string;
    if (weightedInputs.length === 1) {
      sumOutput = weightedInputs[0];
    } else {
      // Chain of Add operations to sum all weighted inputs
      sumOutput = weightedInputs[0];
      for (let j = 1; j < weightedInputs.length; j++) {
        const addOutput = `${neuronPrefix}_sum${j}`;
        nodes.push({
          inputs: [sumOutput, weightedInputs[j]],
          outputs: [addOutput],
          name: `${neuronPrefix}_Add${j}`,
          opType: "Add",
        });
        sumOutput = addOutput;
      }
    }

    // Step 2: Add bias
    const biasName = `${neuronPrefix}_bias`;
    const preActivation = `${neuronPrefix}_preact`;

    initialisers.push({
      name: biasName,
      dataType: OnnxDataType.FLOAT,
      dims: [1],
      floatData: [neuron.bias],
    });

    nodes.push({
      inputs: [sumOutput, biasName],
      outputs: [preActivation],
      name: `${neuronPrefix}_AddBias`,
      opType: "Add",
    });

    // Step 3: Apply activation function
    const squash = neuron.squash ?? "IDENTITY";
    const activationResult = buildActivationNodes(
      squash,
      preActivation,
      tn(i),
      neuronPrefix,
    );

    for (const node of activationResult.nodes) {
      nodes.push(node);
    }

    for (const constName of activationResult.requiredConstants) {
      requiredConstants.add(constName);
    }
  }

  // Add required constant initialisers
  addConstantInitialisers(initialisers, requiredConstants);

  // Graph outputs: one per output neuron
  const outputs: OnnxValueInfo[] = [];
  const outputStartIdx = creature.neurons.length - creature.output;
  for (let i = 0; i < creature.output; i++) {
    outputs.push({
      name: tn(outputStartIdx + i),
      elemType: OnnxDataType.FLOAT,
      shape: [{ dimValue: 1 }],
    });
  }

  return {
    name: graphName,
    nodes,
    inputs,
    outputs,
    initialisers,
  };
}

/** Add constant initialisers needed by composite activation functions. */
function addConstantInitialisers(
  initialisers: OnnxTensor[],
  requiredConstants: Set<string>,
): void {
  const constantValues: Record<string, number> = {
    "const_0.5": 0.5,
    "const_1": 1.0,
    "const_2": 2.0,
    "const_1.702": 1.702,
  };

  for (const name of requiredConstants) {
    const value = constantValues[name];
    if (value !== undefined) {
      initialisers.push({
        name,
        dataType: OnnxDataType.FLOAT,
        dims: [1],
        floatData: [value],
      });
    }
  }
}

/**
 * @module
 *
 * Structural and topological validation for a creature. {@link creatureValidate}
 * checks the invariants a healthy topology must hold — no self or backward
 * connections, no duplicate synapses, every hidden neuron wired in and out,
 * finite biases — and raises a {@link TopologyError} or {@link ValidationError}
 * when a mutation, breeding or discovery step produces an invalid creature.
 */
import { assert } from "@std/assert";
import type { Creature } from "@creature";
import { TopologyError } from "@errors/TopologyError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { neuronWireLabelForDiagnostics } from "@neuron/NeuronSerialization.ts";
import { DIAGNOSTICS_DIR } from "@utils/Diagnostics.ts";
import { TypedTopology } from "@architecture/TypedTopology.ts";
import {
  STRUCTURAL_BIAS_NOT_FINITE,
  STRUCTURAL_CONSTANT_HAS_INWARD,
  STRUCTURAL_HIDDEN_NO_INWARD,
  STRUCTURAL_HIDDEN_NO_OUTWARD,
  STRUCTURAL_IF_MISSING_CONDITION,
  STRUCTURAL_IF_MISSING_NEGATIVE,
  STRUCTURAL_IF_MISSING_POSITIVE,
  STRUCTURAL_IF_TOO_FEW_INWARD,
  STRUCTURAL_SYNAPSE_TARGETS_INPUT,
  TOPOLOGY_BACKWARD_CONNECTION,
  TOPOLOGY_DUPLICATE_CONNECTION,
  TOPOLOGY_SELF_CONNECTION,
  TOPOLOGY_SORT_ERROR_FROM,
  TOPOLOGY_SORT_ERROR_TO,
} from "@wasm/WasmTopologyOps.ts";

const MAX_NEURON_ID = 2_147_483_647; // int32 max

/**
 * Validate the creature
 * @param options specific values to check
 */
export function creatureValidate(
  creature: Creature,
  options?: {
    neurons?: number;
    connections?: number;
    /**
     * When false, recursive (back) synapses are rejected.
     * When true/undefined, recursive synapses are allowed.
     */
    feedbackLoop?: boolean;
    /**
     * Convenience option for production feed-forward validation.
     * When true, all recurrent connections are rejected (both feedback/backward synapses and self-loops).
     *
     * Note: By default (undefined/false) we allow recurrent connections, as this library supports
     * recurrent (memory) topologies.
     */
    forwardOnly?: boolean;
  },
) {
  const forwardOnly = options?.forwardOnly === true;
  const feedbackLoop = forwardOnly ? false : options?.feedbackLoop;
  if (options && options.neurons) {
    if (creature.neurons.length !== options.neurons) {
      throw new ValidationError(
        `Neurons length: ${creature.neurons.length} expected: ${options.neurons}`,
        "OTHER",
      );
    }
  }

  if (Number.isInteger(creature.input) === false || creature.input < 1) {
    throw new ValidationError(
      `Must have at least one input neurons was: ${creature.input}`,
      "OTHER",
    );
  }

  if (Number.isInteger(creature.output) === false || creature.output < 1) {
    throw new ValidationError(
      `Must have at least one output neurons was: ${creature.output}`,
      "OTHER",
    );
  }

  const stats = {
    input: 0,
    constant: 0,
    hidden: 0,
    output: 0,
    connections: 0,
  };

  let outputIndx = 0;
  /** In the computational slice (after inputs, before outputs), hiddens must not precede constants. */
  let computationalSeenHidden = false;
  const neuronIds = new Set<number>();
  creature.neurons.forEach((neuron, indx) => {
    const id = neuron.id;
    if (id === undefined || id === null) {
      throw new ValidationError(`${neuron.ID()}) no id`, "OTHER");
    }
    // Issue #1958: Output neurons have negative IDs (-(outputIndex + 1))
    if (!Number.isInteger(id) || id > MAX_NEURON_ID) {
      debugWrite(creature);
      throw new ValidationError(
        `${neuron.ID()}) invalid neuron id: ${id}`,
        "OTHER",
      );
    }
    if (neuronIds.has(id)) {
      debugWrite(creature);

      throw new ValidationError(
        `${neuron.ID()}) duplicate neuron id: ${id}`,
        "OTHER",
      );
    }
    if (neuron.type === "input") {
      if (id !== indx) {
        debugWrite(creature);
        throw new ValidationError(
          `${neuron.ID()}) invalid input neuron id: ${id}`,
          "OTHER",
        );
      }
    } else {
      if (!Number.isFinite(neuron.bias)) {
        throw new ValidationError(
          `${neuron.ID()}) invalid bias: ${neuron.bias}`,
          "OTHER",
        );
      }
    }

    if (neuron.type === "output") {
      outputIndx++;
    } else if (outputIndx) {
      debugWrite(creature);
      throw new ValidationError(
        `${id}) type ${neuron.type} after output neuron`,
        "OTHER",
      );
    }

    if (neuron.type === "input" && indx > creature.input) {
      debugWrite(creature);

      throw new ValidationError(
        `${id}) input neuron after the maximum input neurons`,
        "OTHER",
      );
    }

    const inComputationalSlice = indx >= creature.input &&
      indx < creature.neurons.length - creature.output;
    if (inComputationalSlice) {
      if (neuron.type === "constant" && computationalSeenHidden) {
        debugWrite(creature);
        throw new ValidationError(
          `${
            neuronWireLabelForDiagnostics(neuron, indx)
          }) type constant after hidden neuron; ` +
            `required order is input, constant, hidden, output`,
          "NEURON_ORDER",
        );
      }
      if (neuron.type === "hidden") {
        computationalSeenHidden = true;
      }
    }

    neuronIds.add(id);

    if (neuron.squash === "IF" && indx > 2) {
      const toList = creature.inwardConnections(indx);
      if (toList.length < 3) {
        throw new ValidationError(
          `${neuron.ID()}) 'IF' should have at least 3 inward connections was: ${toList.length}`,
          "IF_CONDITIONS",
        );
      }

      let foundPositive = false;
      let foundCondition = false;
      let foundNegative = false;

      for (let i = toList.length; i--;) {
        const c = toList[i];
        const synapseType = c.type ?? "positive";
        if (synapseType === "condition") {
          foundCondition = true;
        } else if (synapseType === "negative") {
          foundNegative = true;
        } else if (synapseType === "positive") {
          foundPositive = true;
        }
      }
      if (!foundCondition || !foundPositive || !foundNegative) {
        debugWrite(creature);
      }
      if (!foundCondition) {
        throw new ValidationError(
          `${neuron.ID()}) 'IF' should have a condition(s)`,
          "IF_CONDITIONS",
        );
      }
      if (!foundPositive) {
        throw new ValidationError(
          `${neuron.ID()}) 'IF' should have a positive connection(s)`,
          "IF_CONDITIONS",
        );
      }
      if (!foundNegative) {
        throw new ValidationError(
          `${neuron.ID()}) 'IF' should have a negative connection(s)`,
          "IF_CONDITIONS",
        );
      }
    }
    switch (neuron.type) {
      case "input": {
        stats.input++;
        const toList = creature.inwardConnections(indx);
        if (toList.length > 0) {
          throw new TopologyError(
            `'input' neuron ${neuron.ID()} has inward connections: ${toList.length}`,
            "INVALID_CONNECTION",
          );
        }
        break;
      }
      case "constant": {
        stats.constant++;
        const toList = creature.inwardConnections(indx);
        if (toList.length > 0) {
          debugWrite(creature);
          throw new TopologyError(
            `'${neuron.type}' neuron ${neuron.ID()} has inward connections: ${toList.length}`,
            "INVALID_CONNECTION",
          );
        }
        if (neuron.squash) {
          throw new TopologyError(
            `Node ${neuron.ID()} '${neuron.type}' has squash: ${neuron.squash}`,
            "INVALID_SQUASH",
          );
        }
        const fromList = creature.outwardConnections(indx);
        if (fromList.length === 0) {
          debugWrite(creature);
          throw new ValidationError(
            `constants neuron ${
              neuronWireLabelForDiagnostics(neuron, indx)
            } has no outward connections`,
            "NO_OUTWARD_CONNECTIONS",
          );
        }
        break;
      }
      case "hidden": {
        stats.hidden++;
        const toList = creature.inwardConnections(indx);
        if (toList.length === 0) {
          throw new ValidationError(
            `hidden neuron ${
              neuronWireLabelForDiagnostics(neuron, indx)
            } has no inward connections`,
            "NO_INWARD_CONNECTIONS",
          );
        }
        const fromList = creature.outwardConnections(indx);
        if (fromList.length === 0) {
          debugWrite(creature);
          throw new ValidationError(
            `hidden neuron ${
              neuronWireLabelForDiagnostics(neuron, indx)
            } has no outward connections`,
            "NO_OUTWARD_CONNECTIONS",
          );
        }
        if (neuron.bias === undefined) {
          throw new TopologyError(
            `hidden neuron ${neuron.ID()} should have a bias was: ${neuron.bias}`,
            "INVALID_STATE",
          );
        }
        if (!Number.isFinite(neuron.bias)) {
          throw new TopologyError(
            `${neuron.ID()}) hidden neuron should have a finite bias was: ${neuron.bias}`,
            "INVALID_STATE",
          );
        }

        neuron.validate();

        break;
      }
      case "output": {
        stats.output++;
        neuron.validate();
        break;
      }
      default:
        throw new TopologyError(
          `${neuron.ID()}) Invalid type: ${neuron.type}`,
          "INVALID_NEURON_TYPE",
        );
    }

    if (neuron.index !== indx) {
      throw new ValidationError(
        `${neuron.ID()}) node.index: ${neuron.index} does not match expected index ${indx}`,
        "OTHER",
      );
    }

    if (neuron.creature !== creature) {
      throw new TopologyError(
        `node ${neuron.ID()} creature mismatch`,
        "INVALID_STATE",
      );
    }
  });

  if (stats.input !== creature.input) {
    throw new ValidationError(
      `Expected ${creature.input} input neurons found: ${stats.input}`,
      "OTHER",
    );
  }

  if (stats.output !== creature.output) {
    throw new TopologyError(
      `Expected ${creature.output} output neurons found: ${stats.output}`,
      "INVALID_STATE",
    );
  }

  let lastFrom = -1;
  let lastTo = -1;
  creature.synapses.forEach((c, indx) => {
    stats.connections++;
    const toNode = creature.neurons[c.to];

    if (toNode.type === "input") {
      throw new TopologyError(
        indx + ") connection points to an input node",
        "INVALID_CONNECTION",
      );
    }

    if (forwardOnly && c.from === c.to) {
      debugWrite(creature);
      const fromL = neuronWireLabelForDiagnostics(
        creature.neurons[c.from],
        c.from,
      );
      throw new ValidationError(
        `${indx}) Self connection synapse ${fromL} -> ${fromL}`,
        "SELF_CONNECTION",
      );
    }

    if (c.from < lastFrom) {
      throw new TopologyError(indx + ") synapses not sorted", "SORT_FAILURE");
    } else if (c.from > lastFrom) {
      lastTo = -1;
    }

    if (c.from === lastFrom) {
      if (c.to < lastTo) {
        throw new TopologyError(
          indx + ") synapses not sorted " + c.from + "->" + c.to +
            " last to: " + lastTo,
          "SORT_FAILURE",
        );
      } else if (c.to === lastTo) {
        const fromL = neuronWireLabelForDiagnostics(
          creature.neurons[c.from],
          c.from,
        );
        const toL = neuronWireLabelForDiagnostics(
          creature.neurons[c.to],
          c.to,
        );
        throw new TopologyError(
          `${indx}) duplicate synapse ${fromL} -> ${toL}`,
          "INVALID_CONNECTION",
        );
      }
    }

    if (c.from > c.to) {
      /** Recursive synapses rejected only when explicitly disallowed (feedbackLoop === false) */
      if (feedbackLoop === false) {
        debugWrite(creature);
        const fromL = neuronWireLabelForDiagnostics(
          creature.neurons[c.from],
          c.from,
        );
        const toL = neuronWireLabelForDiagnostics(
          creature.neurons[c.to],
          c.to,
        );
        throw new ValidationError(
          `${indx}) Recursive synapse ${fromL} -> ${toL}`,
          "RECURSIVE_SYNAPSE",
        );
      }
    }

    lastFrom = c.from;
    lastTo = c.to;
  });

  if (options && Number.isInteger(options.connections)) {
    if (creature.synapses.length !== options.connections) {
      throw new ValidationError(
        "Synapses length: " + creature.synapses.length +
          " expected: " +
          options.connections,
        "OTHER",
      );
    }
  }

  // Issue #1961 — WASM-accelerated topology validation for forward-only creatures.
  // Delegates forward-only checks, structural integrity, and cycle detection
  // to Rust/WASM (with TypeScript fallback).
  if (forwardOnly) {
    const topo = TypedTopology.fromCreature(creature);

    // Forward-only topology validation (sort order, self-connections, backward connections)
    const topoResult = topo.validateForwardOnly();
    if (!topoResult.valid) {
      debugWrite(creature);
      const messages: Record<number, string> = {
        [TOPOLOGY_SELF_CONNECTION]: "Self-connection",
        [TOPOLOGY_BACKWARD_CONNECTION]: "Backward connection",
        [TOPOLOGY_SORT_ERROR_FROM]: "From indices not sorted",
        [TOPOLOGY_SORT_ERROR_TO]: "To indices not sorted",
        [TOPOLOGY_DUPLICATE_CONNECTION]: "Duplicate connection",
      };
      throw new TopologyError(
        `WASM topology validation failed: ${
          messages[topoResult.errorCode] ?? "unknown"
        } at synapse ${topoResult.synapseIndex}`,
        "INVALID_CONNECTION",
      );
    }

    // Structural integrity validation
    const structResult = topo.validateStructuralIntegrity();
    if (!structResult.valid) {
      debugWrite(creature);
      const messages: Record<number, string> = {
        [STRUCTURAL_SYNAPSE_TARGETS_INPUT]: "Synapse targets input neuron",
        [STRUCTURAL_CONSTANT_HAS_INWARD]:
          "Constant neuron has inward connections",
        [STRUCTURAL_HIDDEN_NO_INWARD]:
          "Hidden neuron has no inward connections",
        [STRUCTURAL_HIDDEN_NO_OUTWARD]:
          "Hidden neuron has no outward connections",
        [STRUCTURAL_BIAS_NOT_FINITE]: "Non-finite bias",
        [STRUCTURAL_IF_TOO_FEW_INWARD]:
          "IF neuron has too few inward connections",
        [STRUCTURAL_IF_MISSING_CONDITION]:
          "IF neuron missing condition synapse",
        [STRUCTURAL_IF_MISSING_POSITIVE]: "IF neuron missing positive synapse",
        [STRUCTURAL_IF_MISSING_NEGATIVE]: "IF neuron missing negative synapse",
      };
      throw new ValidationError(
        `WASM structural validation failed: ${
          messages[structResult.errorCode] ?? "unknown"
        } at neuron ${structResult.neuronIndex}`,
        "OTHER",
      );
    }

    // Cycle detection — forward-only creatures must be acyclic
    if (topo.detectCycles()) {
      debugWrite(creature);
      throw new TopologyError(
        "Forward-only creature contains cycles",
        "INVALID_CONNECTION",
      );
    }
  }

  if (creature.memetic) {
    const memetic = creature.memetic;
    const idMap = new Map<number, number>();
    creature.neurons.forEach((n, indx) => {
      assert(n.id !== undefined);
      idMap.set(n.id, indx);
    });

    const synapsesSet = new Set<string>();
    creature.synapses.forEach((s) => {
      synapsesSet.add(
        `${creature.neurons[s.from].id}->${creature.neurons[s.to].id}`,
      );
    });

    for (const neuronId in memetic.biases) {
      const neuronIndex = idMap.get(Number(neuronId));
      if (neuronIndex === undefined) {
        throw new ValidationError(
          `Neuron with id ${neuronId} not found in the creature.`,
          "MEMETIC",
        );
      }
    }
    for (const synapseId in memetic.weights) {
      const synapseIndex = idMap.get(Number(synapseId));
      if (synapseIndex === undefined) {
        throw new ValidationError(
          `Synapse with id ${synapseId} not found in the creature.`,
          "MEMETIC",
        );
      }

      const memeticWeights = memetic.weights[synapseId];
      if (!Array.isArray(memeticWeights)) {
        throw new ValidationError(
          `Synapse with id ${synapseId} has invalid weights.`,
          "MEMETIC",
        );
      }
      memeticWeights.forEach((weight, indx) => {
        if (weight.toId === undefined) {
          throw new ValidationError(
            `Memetic from id ${synapseId} to id ${weight.toId} is invalid.`,
            "MEMETIC",
          );
        }
        if (weight.weight === undefined) {
          throw new ValidationError(
            `Memetic from id ${synapseId} to id ${weight.toId} has invalid weight at index ${indx}.`,
            "MEMETIC",
          );
        }
        const toIndex = idMap.get(weight.toId);

        if (toIndex === undefined) {
          throw new ValidationError(
            `Memetic from id ${synapseId} has no valid neuron.`,
            "MEMETIC",
          );
        }
        if (!synapsesSet.has(`${synapseId}->${weight.toId}`)) {
          debugWrite(creature);
          throw new ValidationError(
            `Memetic from id ${synapseId} to id ${weight.toId} has no matching synapses.`,
            "MEMETIC",
          );
        }
      });
    }
  }

  return stats;
}

function debugWrite(creature: Creature) {
  if (creature.DEBUG) {
    Deno.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
    try {
      creature.DEBUG = false;
      let payload: unknown;
      try {
        payload = creature.exportJSON();
      } catch (exportErr) {
        // Invalid or partially corrupted creatures may not serialise; do not
        // mask the original ValidationError from creatureValidate().
        payload = {
          exportFailed: true,
          name: exportErr instanceof Error ? exportErr.name : "Error",
          message: String(exportErr),
        };
      }
      Deno.writeTextFileSync(
        `${DIAGNOSTICS_DIR}/creatureValidate.json`,
        JSON.stringify(payload, null, 1),
      );
    } finally {
      creature.DEBUG = true;
    }
  }
}

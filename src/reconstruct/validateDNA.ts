import { CrisprError } from "@errors/CrisprError.ts";
import type { CrisprInterface } from "@reconstruct/CRISPR.ts";

/**
 * Validates a CRISPR DNA object at runtime, ensuring all required fields
 * are present and have correct types before processing.
 *
 * Accepts both current field names (neurons/synapses) and legacy field
 * names (nodes/connections) since the Upgrade step normalises these.
 *
 * @param dna - The unknown input to validate as CrisprInterface.
 * @returns The validated CrisprInterface object.
 * @throws {CrisprError} Descriptive error if the DNA is malformed.
 */
export function validateDNA(dna: unknown): CrisprInterface {
  if (dna === null || typeof dna !== "object") {
    throw new CrisprError("DNA must be a non-null object", "INVALID_DNA");
  }

  const obj = dna as Record<string, unknown>;

  // Validate id
  if (typeof obj.id !== "string" || obj.id.trim().length === 0) {
    throw new CrisprError("DNA 'id' must be a non-empty string", "INVALID_DNA");
  }

  // Validate mode — undefined defaults to "append" (matching Upgrade.CRISPR
  // behaviour), but any other invalid value is rejected.
  if (
    obj.mode !== undefined && obj.mode !== "insert" && obj.mode !== "append"
  ) {
    throw new CrisprError(
      `DNA 'mode' must be "insert" or "append", got: ${
        JSON.stringify(obj.mode)
      }`,
      "INVALID_DNA",
    );
  }

  const mode = (obj.mode ?? "append") as "insert" | "append";

  // Validate neurons (optional) — accept both "neurons" and legacy "nodes"
  const neurons = obj.neurons ?? obj.nodes;
  if (neurons !== undefined) {
    if (!Array.isArray(neurons)) {
      throw new CrisprError(
        "DNA 'neurons' must be an array",
        "INVALID_DNA",
      );
    }

    for (let i = 0; i < neurons.length; i++) {
      validateNeuron(neurons[i], i, mode);
    }
  }

  // Validate synapses (required) — accept both "synapses" and legacy "connections"
  const synapses = obj.synapses ?? obj.connections;
  if (!Array.isArray(synapses)) {
    throw new CrisprError("DNA 'synapses' must be an array", "INVALID_DNA");
  }

  for (let i = 0; i < synapses.length; i++) {
    validateSynapse(synapses[i], i, mode);
  }

  return dna as CrisprInterface;
}

function validateNeuron(
  neuron: unknown,
  index: number,
  mode: "insert" | "append",
): void {
  if (neuron === null || typeof neuron !== "object") {
    throw new CrisprError(
      `Neuron at index ${index} must be a non-null object`,
      "INVALID_DNA",
    );
  }

  const n = neuron as Record<string, unknown>;

  if (n.type !== "output" && n.type !== "hidden") {
    throw new CrisprError(
      `Neuron at index ${index}: 'type' must be "output" or "hidden", got: ${
        JSON.stringify(n.type)
      }`,
      "INVALID_DNA",
    );
  }

  if (mode === "insert" && n.type === "output") {
    throw new CrisprError(
      `Neuron at index ${index}: insert-mode DNA must not contain output neurons`,
      "INVALID_DNA",
    );
  }

  if (typeof n.squash !== "string" || n.squash.trim().length === 0) {
    throw new CrisprError(
      `Neuron at index ${index}: 'squash' must be a non-empty string`,
      "INVALID_DNA",
    );
  }

  if (typeof n.bias !== "number" || !Number.isFinite(n.bias)) {
    throw new CrisprError(
      `Neuron at index ${index}: 'bias' must be a finite number`,
      "INVALID_DNA",
    );
  }
}

function validateSynapse(
  synapse: unknown,
  index: number,
  mode: "insert" | "append",
): void {
  if (synapse === null || typeof synapse !== "object") {
    throw new CrisprError(
      `Synapse at index ${index} must be a non-null object`,
      "INVALID_DNA",
    );
  }

  const s = synapse as Record<string, unknown>;

  if (typeof s.weight !== "number" || !Number.isFinite(s.weight)) {
    throw new CrisprError(
      `Synapse at index ${index}: 'weight' must be a finite number`,
      "INVALID_DNA",
    );
  }

  if (mode === "insert") {
    if (s.from !== undefined) {
      throw new CrisprError(
        `Synapse at index ${index}: insert-mode DNA must not use 'from' (static index); use 'fromId' instead`,
        "INVALID_DNA",
      );
    }
    if (s.to !== undefined) {
      throw new CrisprError(
        `Synapse at index ${index}: insert-mode DNA must not use 'to' (static index); use 'toId' instead`,
        "INVALID_DNA",
      );
    }
    if (s.fromRelative !== undefined) {
      throw new CrisprError(
        `Synapse at index ${index}: insert-mode DNA must not use 'fromRelative'; use 'fromId' instead`,
        "INVALID_DNA",
      );
    }
    if (s.toRelative !== undefined) {
      throw new CrisprError(
        `Synapse at index ${index}: insert-mode DNA must not use 'toRelative'; use 'toId' instead`,
        "INVALID_DNA",
      );
    }
  }
}

import type { CrisprInterface } from "./CRISPR.ts";

/**
 * Validates a CRISPR DNA object at runtime, ensuring all required fields
 * are present and have correct types before processing.
 *
 * Accepts both current field names (neurons/synapses) and legacy field
 * names (nodes/connections) since the Upgrade step normalises these.
 *
 * @param dna - The unknown input to validate as CrisprInterface.
 * @returns The validated CrisprInterface object.
 * @throws {Error} Descriptive error if the DNA is malformed.
 */
export function validateDNA(dna: unknown): CrisprInterface {
  if (dna === null || typeof dna !== "object") {
    throw new Error("DNA must be a non-null object");
  }

  const obj = dna as Record<string, unknown>;

  // Validate id
  if (typeof obj.id !== "string" || obj.id.trim().length === 0) {
    throw new Error("DNA 'id' must be a non-empty string");
  }

  // Validate mode — undefined defaults to "append" (matching Upgrade.CRISPR
  // behaviour), but any other invalid value is rejected.
  if (
    obj.mode !== undefined && obj.mode !== "insert" && obj.mode !== "append"
  ) {
    throw new Error(
      `DNA 'mode' must be "insert" or "append", got: ${
        JSON.stringify(obj.mode)
      }`,
    );
  }

  const mode = (obj.mode ?? "append") as "insert" | "append";

  // Validate neurons (optional) — accept both "neurons" and legacy "nodes"
  const neurons = obj.neurons ?? obj.nodes;
  if (neurons !== undefined) {
    if (!Array.isArray(neurons)) {
      throw new Error("DNA 'neurons' must be an array");
    }

    for (let i = 0; i < neurons.length; i++) {
      validateNeuron(neurons[i], i, mode);
    }
  }

  // Validate synapses (required) — accept both "synapses" and legacy "connections"
  const synapses = obj.synapses ?? obj.connections;
  if (!Array.isArray(synapses)) {
    throw new Error("DNA 'synapses' must be an array");
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
    throw new Error(`Neuron at index ${index} must be a non-null object`);
  }

  const n = neuron as Record<string, unknown>;

  if (n.type !== "output" && n.type !== "hidden") {
    throw new Error(
      `Neuron at index ${index}: 'type' must be "output" or "hidden", got: ${
        JSON.stringify(n.type)
      }`,
    );
  }

  if (mode === "insert" && n.type === "output") {
    throw new Error(
      `Neuron at index ${index}: insert-mode DNA must not contain output neurons`,
    );
  }

  if (typeof n.squash !== "string" || n.squash.trim().length === 0) {
    throw new Error(
      `Neuron at index ${index}: 'squash' must be a non-empty string`,
    );
  }

  if (typeof n.bias !== "number" || !Number.isFinite(n.bias)) {
    throw new Error(
      `Neuron at index ${index}: 'bias' must be a finite number`,
    );
  }
}

function validateSynapse(
  synapse: unknown,
  index: number,
  mode: "insert" | "append",
): void {
  if (synapse === null || typeof synapse !== "object") {
    throw new Error(`Synapse at index ${index} must be a non-null object`);
  }

  const s = synapse as Record<string, unknown>;

  if (typeof s.weight !== "number" || !Number.isFinite(s.weight)) {
    throw new Error(
      `Synapse at index ${index}: 'weight' must be a finite number`,
    );
  }

  if (mode === "insert") {
    if (s.from !== undefined) {
      throw new Error(
        `Synapse at index ${index}: insert-mode DNA must not use 'from' (static index); use 'fromUUID' instead`,
      );
    }
    if (s.to !== undefined) {
      throw new Error(
        `Synapse at index ${index}: insert-mode DNA must not use 'to' (static index); use 'toUUID' instead`,
      );
    }
    if (s.fromRelative !== undefined) {
      throw new Error(
        `Synapse at index ${index}: insert-mode DNA must not use 'fromRelative'; use 'fromUUID' instead`,
      );
    }
    if (s.toRelative !== undefined) {
      throw new Error(
        `Synapse at index ${index}: insert-mode DNA must not use 'toRelative'; use 'toUUID' instead`,
      );
    }
  }
}

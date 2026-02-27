/**
 * Validates a creature export object against the NEAT-AI snapshot schema.
 *
 * Uses structural validation without external dependencies, matching the
 * JSON schema defined in docs/snapshot-schema.json.
 */

const VALID_NEURON_TYPES = new Set(["hidden", "output", "constant"]);
const VALID_SYNAPSE_TYPES = new Set(["positive", "negative", "condition"]);

/**
 * Validate a value against the NEAT-AI creature export (snapshot) schema.
 *
 * @param data - The value to validate.
 * @returns An array of error messages. Empty array means the data is valid.
 */
export function validateCreatureExport(data: unknown): string[] {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push("Root must be a non-null object");
    return errors;
  }

  const obj = data as Record<string, unknown>;

  // Required fields
  if (!Array.isArray(obj.neurons)) {
    errors.push("'neurons' is required and must be an array");
  }
  if (!Array.isArray(obj.synapses)) {
    errors.push("'synapses' is required and must be an array");
  }
  if (
    typeof obj.input !== "number" || !Number.isInteger(obj.input) ||
    (obj.input as number) < 1
  ) {
    errors.push("'input' is required and must be a positive integer");
  }
  if (
    typeof obj.output !== "number" || !Number.isInteger(obj.output) ||
    (obj.output as number) < 1
  ) {
    errors.push("'output' is required and must be a positive integer");
  }

  // Optional fields
  if (
    obj.semanticVersion !== undefined &&
    typeof obj.semanticVersion !== "string"
  ) {
    errors.push("'semanticVersion' must be a string when present");
  }
  if (obj.forwardOnly !== undefined && typeof obj.forwardOnly !== "boolean") {
    errors.push("'forwardOnly' must be a boolean when present");
  }

  // Validate neurons
  if (Array.isArray(obj.neurons)) {
    for (let i = 0; i < obj.neurons.length; i++) {
      const neuronErrors = validateNeuron(obj.neurons[i], i);
      errors.push(...neuronErrors);
    }
  }

  // Validate synapses
  if (Array.isArray(obj.synapses)) {
    for (let i = 0; i < obj.synapses.length; i++) {
      const synapseErrors = validateSynapse(obj.synapses[i], i);
      errors.push(...synapseErrors);
    }
  }

  // Validate tags
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) {
      errors.push("'tags' must be an array when present");
    } else {
      for (let i = 0; i < obj.tags.length; i++) {
        const tagErrors = validateTag(obj.tags[i], `tags[${i}]`);
        errors.push(...tagErrors);
      }
    }
  }

  // Validate memetic
  if (obj.memetic !== undefined) {
    const memeticErrors = validateMemetic(obj.memetic);
    errors.push(...memeticErrors);
  }

  return errors;
}

function validateNeuron(data: unknown, index: number): string[] {
  const prefix = `neurons[${index}]`;
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push(`${prefix} must be a non-null object`);
    return errors;
  }

  const neuron = data as Record<string, unknown>;

  if (typeof neuron.type !== "string" || !VALID_NEURON_TYPES.has(neuron.type)) {
    errors.push(
      `${prefix}.type must be one of: hidden, output, constant`,
    );
  }
  if (typeof neuron.uuid !== "string") {
    errors.push(`${prefix}.uuid must be a string`);
  }
  if (typeof neuron.bias !== "number") {
    errors.push(`${prefix}.bias must be a number`);
  }
  if (neuron.squash !== undefined && typeof neuron.squash !== "string") {
    errors.push(`${prefix}.squash must be a string when present`);
  }

  if (neuron.tags !== undefined) {
    if (!Array.isArray(neuron.tags)) {
      errors.push(`${prefix}.tags must be an array when present`);
    } else {
      for (let i = 0; i < neuron.tags.length; i++) {
        const tagErrors = validateTag(neuron.tags[i], `${prefix}.tags[${i}]`);
        errors.push(...tagErrors);
      }
    }
  }

  return errors;
}

function validateSynapse(data: unknown, index: number): string[] {
  const prefix = `synapses[${index}]`;
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push(`${prefix} must be a non-null object`);
    return errors;
  }

  const synapse = data as Record<string, unknown>;

  if (typeof synapse.fromUUID !== "string") {
    errors.push(`${prefix}.fromUUID must be a string`);
  }
  if (typeof synapse.toUUID !== "string") {
    errors.push(`${prefix}.toUUID must be a string`);
  }
  if (typeof synapse.weight !== "number") {
    errors.push(`${prefix}.weight must be a number`);
  }
  if (synapse.type !== undefined) {
    if (
      typeof synapse.type !== "string" ||
      !VALID_SYNAPSE_TYPES.has(synapse.type)
    ) {
      errors.push(
        `${prefix}.type must be one of: positive, negative, condition`,
      );
    }
  }

  if (synapse.tags !== undefined) {
    if (!Array.isArray(synapse.tags)) {
      errors.push(`${prefix}.tags must be an array when present`);
    } else {
      for (let i = 0; i < synapse.tags.length; i++) {
        const tagErrors = validateTag(
          synapse.tags[i],
          `${prefix}.tags[${i}]`,
        );
        errors.push(...tagErrors);
      }
    }
  }

  return errors;
}

function validateTag(data: unknown, prefix: string): string[] {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push(`${prefix} must be a non-null object`);
    return errors;
  }

  const tag = data as Record<string, unknown>;

  if (typeof tag.name !== "string") {
    errors.push(`${prefix}.name must be a string`);
  }
  if (typeof tag.value !== "string") {
    errors.push(`${prefix}.value must be a string`);
  }

  return errors;
}

function validateMemetic(data: unknown): string[] {
  const prefix = "memetic";
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push(`${prefix} must be a non-null object`);
    return errors;
  }

  const memetic = data as Record<string, unknown>;

  if (
    typeof memetic.generation !== "number" ||
    !Number.isInteger(memetic.generation) ||
    (memetic.generation as number) < 0
  ) {
    errors.push(`${prefix}.generation must be a non-negative integer`);
  }
  if (typeof memetic.weights !== "object" || memetic.weights === null) {
    errors.push(`${prefix}.weights must be an object`);
  }
  if (typeof memetic.biases !== "object" || memetic.biases === null) {
    errors.push(`${prefix}.biases must be an object`);
  }
  if (typeof memetic.score !== "number") {
    errors.push(`${prefix}.score must be a number`);
  }

  if (memetic.ancestry !== undefined) {
    if (!Array.isArray(memetic.ancestry)) {
      errors.push(`${prefix}.ancestry must be an array when present`);
    } else if (memetic.ancestry.length > 3) {
      errors.push(`${prefix}.ancestry must have at most 3 entries`);
    }
  }

  return errors;
}

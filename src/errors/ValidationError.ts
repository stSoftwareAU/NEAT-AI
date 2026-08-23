/**
 * Typed error for validation failures.
 *
 * Consumers can catch `ValidationError` and inspect `reason` to handle
 * specific failure modes programmatically.
 *
 * @module ValidationError
 */

export type ValidationErrorName =
  | "OTHER"
  | "NEURON_ORDER"
  | "NO_OUTWARD_CONNECTIONS"
  | "NO_INWARD_CONNECTIONS"
  | "IF_CONDITIONS"
  | "RECURSIVE_SYNAPSE"
  | "SELF_CONNECTION"
  | "DUPLICATE_SYNAPSE"
  | "MEMETIC";

export class ValidationError extends Error {
  override readonly name = "ValidationError";
  readonly reason: ValidationErrorName;
  /**
   * Index into `creature.neurons` of the neuron the failed rule named, when the
   * rule named one (Issue #3848).
   *
   * NEAT-AI-core reports it and the message quotes the neuron's wire label, but
   * until now only the words survived rehydration — a caller wanting to repair
   * the failure had to parse the sentence or re-scan the whole creature. Carrying
   * the index makes a repair pass able to say *"rule R failed at element E, so I
   * changed E"* and change nothing else. Undefined for the rules that name no
   * neuron (the synapse rules, the neuron-type counts, the memetic
   * cross-references).
   *
   * The index is only meaningful against the creature the error was raised from,
   * and only until that creature's neuron array is edited — re-validate after
   * every repair rather than reusing a stale index.
   */
  readonly neuronIndex?: number;

  constructor(
    message: string,
    reason: ValidationErrorName,
    neuronIndex?: number,
  ) {
    super(message);
    this.reason = reason;
    this.neuronIndex = neuronIndex;
  }
}

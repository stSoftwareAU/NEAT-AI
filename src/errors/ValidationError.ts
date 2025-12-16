export type ValidationErrorName =
  | "OTHER"
  | "NO_OUTWARD_CONNECTIONS"
  | "NO_INWARD_CONNECTIONS"
  | "IF_CONDITIONS"
  | "RECURSIVE_SYNAPSE"
  | "SELF_CONNECTION"
  | "MEMETIC";

export class ValidationError extends Error {
  constructor(message: string, name: ValidationErrorName) {
    super(message);
    this.name = name;
  }
}

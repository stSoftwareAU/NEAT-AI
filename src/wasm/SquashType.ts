/**
 * Squash type enum for WASM activation
 * Must match the SquashType enum in wasm_activation/src/lib.rs
 *
 * Issue #1116 - WASM prototype for creature activation
 */
export enum SquashType {
  Identity = 0,
  Relu = 1,
  Relu6 = 2,
  LeakyRelu = 3,
  Selu = 4,
  Elu = 5,
  Logistic = 6,
  Tanh = 7,
  HardTanh = 8,
  Softsign = 9,
  Softplus = 10,
  Swish = 11,
  Mish = 12,
  Gelu = 13,
  Sine = 14,
  Cosine = 15,
  Tan = 16,
  ArcTan = 17,
  Gaussian = 18,
  BentIdentity = 19,
  BipolarSigmoid = 20,
  Bipolar = 21,
  Step = 22,
  Complement = 23,
  Absolute = 24,
  Square = 25,
  Cube = 26,
  Sqrt = 27,
  StdInverse = 28,
  Exponential = 29,
  LogSigmoid = 30,
  Isru = 31,
}

/**
 * Map from squash function name (as used in TypeScript) to SquashType enum value
 */
export const SQUASH_NAME_TO_TYPE: Record<string, SquashType> = {
  "IDENTITY": SquashType.Identity,
  "ReLU": SquashType.Relu,
  "ReLU6": SquashType.Relu6,
  "LeakyReLU": SquashType.LeakyRelu,
  "SELU": SquashType.Selu,
  "ELU": SquashType.Elu,
  "LOGISTIC": SquashType.Logistic,
  "TANH": SquashType.Tanh,
  "HARD_TANH": SquashType.HardTanh,
  "SOFTSIGN": SquashType.Softsign,
  "Softplus": SquashType.Softplus,
  "Swish": SquashType.Swish,
  "Mish": SquashType.Mish,
  "GELU": SquashType.Gelu,
  "SINE": SquashType.Sine,
  "Cosine": SquashType.Cosine,
  "TAN": SquashType.Tan,
  "ArcTan": SquashType.ArcTan,
  "GAUSSIAN": SquashType.Gaussian,
  "BENT_IDENTITY": SquashType.BentIdentity,
  "BIPOLAR_SIGMOID": SquashType.BipolarSigmoid,
  "BIPOLAR": SquashType.Bipolar,
  "STEP": SquashType.Step,
  "COMPLEMENT": SquashType.Complement,
  "ABSOLUTE": SquashType.Absolute,
  "SQUARE": SquashType.Square,
  "Cube": SquashType.Cube,
  "SQRT": SquashType.Sqrt,
  "StdInverse": SquashType.StdInverse,
  "Exponential": SquashType.Exponential,
  "LogSigmoid": SquashType.LogSigmoid,
  "ISRU": SquashType.Isru,
};

/**
 * Get the SquashType for a given squash function name
 * Returns Identity if the squash name is not found
 */
export function getSquashType(squashName: string | undefined): SquashType {
  if (!squashName) {
    return SquashType.Identity;
  }
  return SQUASH_NAME_TO_TYPE[squashName] ?? SquashType.Identity;
}

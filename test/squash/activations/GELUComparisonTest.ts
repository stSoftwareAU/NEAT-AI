import { assert } from "@std/assert";
import { GELU } from "../../../src/methods/activations/types/GELU.ts";
import { ActivationRange } from "../../../src/propagate/ActivationRange.ts";

// Create a modified version of GELU without the early return condition
class LegacyGELU {
  private range = new ActivationRange(
    GELU.NAME,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  public squash(x: number): number {
    const sqrtTwoOverPi = Math.sqrt(2 / Math.PI);
    const term = x + 0.044715 * Math.pow(x, 3);
    const tanhResult = Math.tanh(sqrtTwoOverPi * term);
    const value = 0.5 * x * (1 + tanhResult);

    return this.range.limit(value);
  }
  private readonly MAX_ITERATIONS = 100; // Maximum iterations for Newton-Raphson

  private readonly TOLERANCE = 1e-6;
  unSquash(activation: number, hint?: number): number {
    this.range.validate(activation, hint);

    // Special case: if activation is very close to zero
    if (Math.abs(activation) < 1e-10) {
      // If we have a hint, use it directly
      if (hint !== undefined) {
        return hint;
      }
      // Default for very small values
      return -10;
    }

    // Initialize x with a good starting point
    let x: number;

    // Use hint if provided
    if (hint !== undefined) {
      x = hint;
    } else {
      // Otherwise, use a reasonable starting point based on the activation
      x = activation < 0.5 ? -1 : 1;
    }

    // Newton-Raphson iteration
    for (let i = 0; i < this.MAX_ITERATIONS; i++) {
      const fx = this.squash(x) - activation;
      if (Math.abs(fx) < this.TOLERANCE) {
        break;
      }

      const dfx = this.derivative(x);
      if (Math.abs(dfx) < 1e-10) {
        // If derivative is too small, break out
        break;
      }

      const nextX = x - fx / dfx; // Newton-Raphson update

      if (!Number.isFinite(nextX) || Math.abs(nextX) > 10) {
        // If x becomes non-finite or unreasonably large, reset to hint or activation
        x = hint ?? 0;
        break;
      }

      x = nextX;
    }

    return x;
  }

  derivative(x: number): number {
    const sqrtTwoOverPi = Math.sqrt(2 / Math.PI);
    const a = 0.044715 * Math.pow(x, 3);
    const b = sqrtTwoOverPi * (x + a);
    const sech2 = (2 / (Math.exp(b) + Math.exp(-b))) ** 2;
    return 0.5 * x * sech2 * sqrtTwoOverPi * (3 * 0.044715 * x * x + 1) +
      0.5 * (1 + Math.tanh(b));
  }
}

Deno.test("GELU implementation comparison", () => {
  const gelu = new GELU();
  const legacyGELU = new LegacyGELU();

  // Test a range of values
  const testValues = [
    -20,
    -15,
    -10,
    -9,
    -8,
    -7,
    -6,
    -5.1,
    -5,
    -4.2,
    -4,
    -3,
    -2.3,
    -2,
    -1,
    -0.5,
    -0.046,
    -0.159,
    -Number.EPSILON,
    0,
    Number.EPSILON,
    0.5,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    15,
    20,
  ];

  const data: {
    value: number;
    current: number;
    legacy: number;
    difference: number;
    unsquash: number;
    legacyUnsquash: number;
    valid: boolean;
  }[] = [];
  //
  let failures = 0;
  for (const x of testValues) {
    const currentValue = gelu.squash(x);
    const legacyValue = legacyGELU.squash(x);
    const difference = Math.abs(currentValue - legacyValue);
    let failedSquash = false;
    // Check if the values are significantly different
    if (difference > 1e-10) {
      //   console.log(`WARNING: Significant difference at x = ${x}`);
      failures++;
      failedSquash = true;
    }

    const hint = x - 0.2;
    const currentUnsquash = gelu.unSquash(currentValue, hint);
    const legacyUnsquash = legacyGELU.unSquash(legacyValue, hint);
    const differenceUnsquash = Math.abs(currentUnsquash - legacyUnsquash);
    let failedUnsquash = false;
    if (differenceUnsquash > 1e-10) {
      //   console.log(`WARNING: Significant difference at x = ${x}`);
      failures++;
      failedUnsquash = true;
    }
    if (Math.abs(currentUnsquash - x) > 0.21) {
      failedUnsquash = true;
      failures++;
      legacyGELU.unSquash(legacyValue, hint);
    }
    data.push({
      value: x,
      current: currentValue,
      legacy: legacyValue,
      difference: difference,
      unsquash: currentUnsquash,
      legacyUnsquash: legacyUnsquash,
      valid: !failedSquash && !failedUnsquash,
    });
  }
  console.table(data);

  assert(failures === 0, `Found ${failures} failures`);
});

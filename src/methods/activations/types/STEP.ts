import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

/**
 * Step Activation Function
 *
 * The Step function is a simple threshold-based activation function.
 * It outputs 1 if the input is greater than 0 and 0 otherwise.
 *
 * The derivative is technically undefined at x=0 and 0 everywhere else.
 * However, in practice, it's often taken as 0.
 *
 * Reference:
 * https://en.wikipedia.org/wiki/Step_function
 */
export class STEP implements ActivationInterface, UnSquashInterface {
  // Function to estimate the input from the activation value.
  // Given the non-invertible nature of the Step function,
  // returning the activation as an estimate.
  unSquash(activation: number): number {
    return activation;
  }

  // Range of the activation function. Step outputs values between 0 and 1.
  range(): { low: number; high: number } {
    return { low: 0, high: 1 };
  }

  public static NAME = "STEP";

  getName() {
    return STEP.NAME;
  }

  // Step function definition
  squash(x: number) {
    return x > 0 ? 1 : 0;
  }

  // Function to calculate the activation and its derivative
  squashAndDerive(x: number) {
    const fx = this.squash(x);

    return {
      activation: fx,
      derivative: 0,
    };
  }
}

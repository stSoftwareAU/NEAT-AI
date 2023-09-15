/**
 * EXPONENTIAL activation function
 * Squash function: f(x) = exp(x)
 * Range: (0, +Infinity)
 * Source: Custom (Exponential is a standard mathematical function)
 */
import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

export class Exponential implements ActivationInterface, UnSquashInterface {
  public static NAME = "Exponential";

  getName() {
    return Exponential.NAME;
  }

  squash(x: number) {
    return Math.exp(x);
  }

  unSquash(activation: number): number {
    return Math.log(activation);
  }

  squashAndDerive(x: number) {
    return {
      activation: this.squash(x),
      derivative: this.squash(x),
    };
  }

  range(): { low: number; high: number } {
    return { low: 0, high: Number.POSITIVE_INFINITY };
  }
}

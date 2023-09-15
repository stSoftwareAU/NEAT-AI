/**
 * Cosine activation function
 * Squash function: f(x) = cos(x)
 * Range: [-1, 1]
 * Source: Custom (Cosine is a standard mathematical function)
 */
import { ActivationInterface } from "../ActivationInterface.ts";
import { UnSquashInterface } from "../UnSquashInterface.ts";

export class Cosine implements ActivationInterface, UnSquashInterface {
  public static NAME = "Cosine";

  getName() {
    return Cosine.NAME;
  }

  squash(x: number) {
    return Math.cos(x);
  }

  unSquash(activation: number): number {
    return Math.acos(activation);
  }

  squashAndDerive(x: number) {
    return {
      activation: this.squash(x),
      derivative: -Math.sin(x),
    };
  }

  range(): { low: number; high: number } {
    return { low: -1, high: 1 };
  }
}

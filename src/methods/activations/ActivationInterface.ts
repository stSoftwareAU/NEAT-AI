import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";

interface SquashAndDeriveResult {
  activation: number;
  derivative: number;
}

export interface ActivationInterface extends AbstractActivationInterface {
  squash(x: number): number;
}

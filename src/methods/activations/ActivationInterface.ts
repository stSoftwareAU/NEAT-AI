import type { AbstractActivationInterface } from "./AbstractActivationInterface.ts";

interface SquashAndDeriveResult {
  activation: number;
  derivative: number;
}

export interface ActivationInterface extends AbstractActivationInterface {
  squash(x: number): number;
}

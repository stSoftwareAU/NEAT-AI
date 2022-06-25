import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";

interface SquashAndDeriveResult {
  activation: number;
  derivative: number;
}

export interface ActivationInterface extends AbstractActivationInterface {
  squashAndDerive(x: number): SquashAndDeriveResult;
  squash(x: number): number;
}

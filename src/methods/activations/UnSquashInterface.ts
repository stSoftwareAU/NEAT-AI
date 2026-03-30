import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";

export interface UnSquashInterface extends AbstractActivationInterface {
  unSquash(activation: number, hint?: number): number;
}

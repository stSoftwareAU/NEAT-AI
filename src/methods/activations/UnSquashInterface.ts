import type { AbstractActivationInterface } from "./AbstractActivationInterface.ts";

export interface UnSquashInterface extends AbstractActivationInterface {
  unSquash(activation: number, hint?: number): number;
}

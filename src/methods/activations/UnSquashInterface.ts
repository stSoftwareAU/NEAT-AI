import { AbstractActivationInterface } from "./AbstractActivationInterface.ts";

export interface UnSquashInterface extends AbstractActivationInterface {
  unSquash(activation: number): number;
  range(): { low: number; high: number };
}

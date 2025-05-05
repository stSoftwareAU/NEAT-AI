import type { ActivationRange } from "../../propagate/ActivationRange.ts";

export interface AbstractActivationInterface {
  getName(): string;
  readonly range: ActivationRange;
  derivative?(value: number): number;
  calculateError?(
    currentActivation: number,
    targetActivation: number,
    hint?: number,
  ): number;
}

import type { ActivationRange } from "../../propagate/ActivationRange.ts";

export interface AbstractActivationInterface {
  getName(): string;
  readonly range: ActivationRange;
}

import type { CreatureState } from "./CreatureState.ts";

export interface SquasherInterface {
  squash(activations: Float32Array): number;
  squashAndTrace(state: CreatureState, activations: Float32Array): number;
}

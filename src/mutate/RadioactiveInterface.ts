import type { MutationBias } from "../predictiveCoding/PredictionErrorGuidedMutation.ts";

export interface RadioactiveInterface {
  mutate(focusList?: number[], mutationBias?: MutationBias): boolean;
}

/**
 * @module
 *
 * Shared contract for "radioactive" mutation operators: a single `mutate`
 * entry point that applies one structural change to a creature, optionally
 * steered by a {@link MutationBias} from predictive-coding error guidance.
 * Implemented by the abstract mutation operator so every operator in the
 * `@mutate/` catalogue exposes the same interface.
 */
import type { MutationBias } from "@predictiveCoding/PredictionErrorGuidedMutation.ts";

export interface RadioactiveInterface {
  mutate(focusList?: number[], mutationBias?: MutationBias): boolean;
}

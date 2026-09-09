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
  /**
   * Index of the neuron the most recent {@link mutate} call changed, or `-1`
   * when the operator names no neuron site. Issue #3971: the per-operator
   * telemetry buckets a structural mutation by the depth of this site.
   */
  readonly lastMutationSiteIndex?: number;
}

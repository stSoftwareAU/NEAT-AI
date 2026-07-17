/**
 * AggregateRecord.ts - Self-recording for aggregate-squash neurons.
 *
 * Issue #3389: Aggregate-squash neurons (MAXIMUM/MINIMUM/IF) implement their
 * own `record()`, which delegates the error-attribution walk to the selected
 * input path. That delegation bypasses the value/error write in
 * `NeuronRecord.record()`, so the aggregate neuron's own quantities were never
 * recorded — every aggregate neuron (including `output-0` when it aggregates)
 * exported a fully-null `value` series and no `errors`.
 *
 * Each aggregate `record()` already computes the quantities internally; this
 * helper writes them onto the shared discover record before delegating.
 */

import type { Neuron } from "@architecture/Neuron.ts";
import type { DiscoverRecord } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

/**
 * Write an aggregate neuron's own pre-activation value and attributed error.
 *
 * Mirrors the semantics of the standard record walk in `NeuronRecord.record()`:
 * the value is written once (the first finite computation wins) and only the
 * first visit contributes an error, so repeated traversals of the same neuron
 * cannot inflate the error series.
 *
 * @param neuron - the aggregate-squash neuron being recorded
 * @param currentValue - `toValue(neuron, currentActivation)` as computed by the
 *   caller's `record()` implementation
 * @param error - the attributed error in value space (target − current), or 0
 *   when the requested activation already matches
 * @param discoverMap - the discovery record map for this observation
 */
export function recordAggregateSelf(
  neuron: Neuron,
  currentValue: number,
  error: number,
  discoverMap: Map<number, DiscoverRecord>,
): void {
  let discoverRecord = discoverMap.get(neuron.id);
  if (discoverRecord === undefined) {
    discoverRecord = {
      activation: neuron.creature.state.activations[neuron.index],
      errors: [],
    };
    discoverMap.set(neuron.id, discoverRecord);
  }

  const existingValue = discoverRecord.value;
  if (
    (existingValue === undefined || Number.isFinite(existingValue) === false) &&
    Number.isFinite(currentValue)
  ) {
    discoverRecord.value = currentValue;
  }

  if (discoverRecord.errors.length === 0 && Number.isFinite(error)) {
    discoverRecord.errors.push(error);
  }
}

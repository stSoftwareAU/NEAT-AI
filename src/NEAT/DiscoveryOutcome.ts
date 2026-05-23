/**
 * DiscoveryOutcome.ts — pure decision helper for the `discovery_complete`
 * training event's `outcome` field.
 *
 * Issue #2737: Centralises the rule that picks `"heap_critical_skip"` over
 * `"no_change"` when `DataRecorder.recordFiles()` aborted at the
 * analysis-extension boundary because the V8 heap was at MemoryMonitor
 * CRITICAL pressure. Extracted out of `ProcessCompletedResults.ts` so the
 * mapping can be unit-tested without standing up a full `Neat` instance.
 */

import type { DiscoveryCompleteEvent } from "@config/TrainingEvent.ts";

/**
 * Minimal projection of a `DiscoverResult` needed to choose an outcome.
 *
 * Defined as an interface (not a re-export of `DiscoverResult`) so callers
 * can pass any shape that carries the two relevant fields — including the
 * wire-cloned payload produced by `buildDiscoverResponsePayload` in the
 * worker thread.
 */
export interface DiscoveryOutcomeInputs {
  /**
   * `true` when discovery skipped the analysis phase because the V8 heap
   * was at MemoryMonitor CRITICAL pressure at the analysis-extension
   * boundary (Issue #2737).
   */
  readonly heapAbortedAtExtensionBoundary?: boolean;
  /**
   * Truthy when discovery built an improved creature ready to add to the
   * population.
   */
  readonly improvedCreature?: unknown;
}

/**
 * Choose the `discovery_complete` outcome label for a finished discovery
 * result.
 *
 * The order of precedence is deliberate:
 *
 * 1. `"heap_critical_skip"` — memory pressure pre-empted analysis. This
 *    must win over `"no_change"` so callers can tell a memory-pressure
 *    skip apart from a clean "found nothing" run (Issue #2737).
 * 2. `"improved"` — discovery built an improved creature.
 * 3. `"no_change"` — discovery ran to completion but found no improvement.
 *
 * Note: `"timeout"` is part of the `DiscoveryCompleteEvent.outcome` union
 * but is not selectable from these inputs; the upstream worker reports
 * timeouts via a separate path. We narrow the return type to the labels
 * this helper can actually emit so callers get an exhaustive switch hint.
 */
export function chooseDiscoveryCompleteOutcome(
  inputs: DiscoveryOutcomeInputs,
): Extract<
  DiscoveryCompleteEvent["outcome"],
  "improved" | "no_change" | "heap_critical_skip"
> {
  if (inputs.heapAbortedAtExtensionBoundary) return "heap_critical_skip";
  if (inputs.improvedCreature) return "improved";
  return "no_change";
}

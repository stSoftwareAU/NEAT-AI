/**
 * Barrel re-export for focus neuron selection.
 *
 * This module re-exports all focus selection functions from their
 * focused sub-modules to maintain backwards compatibility.
 */

export { listViableNeurons } from "@architecture/ErrorGuidedStructuralEvolution/FocusSelectionRanking.ts";

export {
  DEFAULT_FOCUS_DROUGHT_THRESHOLD,
  focusSelectionKey,
  selectNeuronsWeightedByError,
  updateFocusSelectionSummary,
  writeFocusSelectionAnalysis,
} from "@architecture/ErrorGuidedStructuralEvolution/FocusSelectionWeighting.ts";
export type { FocusDiversityOptions } from "@architecture/ErrorGuidedStructuralEvolution/FocusSelectionWeighting.ts";

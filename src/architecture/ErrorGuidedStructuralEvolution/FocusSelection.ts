/**
 * Barrel re-export for focus neuron selection.
 *
 * This module re-exports all focus selection functions from their
 * focused sub-modules to maintain backwards compatibility.
 */

export { listViableNeurons } from "./FocusSelectionRanking.ts";

export {
  focusSelectionKey,
  selectNeuronsWeightedByError,
  updateFocusSelectionSummary,
  writeFocusSelectionAnalysis,
} from "./FocusSelectionWeighting.ts";

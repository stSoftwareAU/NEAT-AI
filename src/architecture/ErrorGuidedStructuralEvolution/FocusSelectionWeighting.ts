/**
 * Error-weighted neuron selection for discovery focus.
 *
 * Implements roulette wheel selection weighted by error × impact,
 * with fallback to random selection. Also provides focus selection
 * summary and analysis utilities.
 */
import { assert } from "@std/assert";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import type {
  FocusNeuronCandidate,
  FocusSelectionAnalysis,
  FocusSelectionMode,
  FocusSelectionSummary,
  LowImpactNeuron,
  NeuronErrorInfo,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";

/**
 * Default number of epochs without an accepted candidate before focus
 * selection abandons error-weighted roulette in favour of deterministic
 * round-robin across the top-ranked neurons (Issue #3074). On a plateaued
 * network the squared roulette weighting otherwise keeps re-selecting the same
 * dominant neuron; round-robin guarantees the focus list rotates through
 * distinct targets while the drought persists.
 */
export const DEFAULT_FOCUS_DROUGHT_THRESHOLD = 20;

/**
 * Optional diversity controls for {@link selectNeuronsWeightedByError}
 * (Issue #3074).
 */
export interface FocusDiversityOptions {
  /**
   * Number of discovery epochs since a candidate was last accepted. When this
   * exceeds {@link FocusDiversityOptions.droughtThreshold} the selection
   * switches to round-robin across the top-ranked neurons. Defaults to 0 (no
   * drought).
   */
  epochsSinceLastAccepted?: number;
  /**
   * Drought threshold in epochs. Defaults to
   * {@link DEFAULT_FOCUS_DROUGHT_THRESHOLD}.
   */
  droughtThreshold?: number;
}

/**
 * Computes the share of total weight held by the single heaviest entry
 * (Issue #3074). Returns 0 for an empty or non-positive distribution.
 */
function weightConcentration(weights: readonly number[]): number {
  let max = 0;
  let total = 0;
  for (const w of weights) {
    if (!Number.isFinite(w) || w <= 0) continue;
    total += w;
    if (w > max) max = w;
  }
  return total > 0 ? max / total : 0;
}

/**
 * Applies the diversity floor to a roulette weight distribution (Issue #3074).
 *
 * Iteratively clips any weight above the running mean (`total / N`) down to
 * that mean until no weight exceeds it ("water filling"). At the fixed point
 * the heaviest neuron holds at most a `1/N` share of the total, so no single
 * neuron can dominate the wheel, while sub-mean weights are left untouched so
 * the relative ordering of the tail survives. Returns a new array; the input
 * is not mutated.
 */
function applyDiversityFloor(weights: readonly number[]): number[] {
  const n = weights.length;
  let current = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  if (n === 0) return current;
  // Weights only ever decrease and the total is monotonically non-increasing,
  // so this converges quickly; the iteration cap is a safety backstop.
  for (let iter = 0; iter < 100; iter++) {
    let total = 0;
    for (const w of current) total += w;
    if (total <= 0) break;
    const cap = total / n;
    let changed = false;
    current = current.map((w) => {
      if (w > cap) {
        changed = true;
        return cap;
      }
      return w;
    });
    if (!changed) break;
  }
  return current;
}

/**
 * Generates a cache key for focus selection.
 */
export function focusSelectionKey(focusList: readonly number[]): string {
  return focusList.join("|");
}

/**
 * Updates the focus selection summary for debugging.
 */
export function updateFocusSelectionSummary(
  loggingEnabled: boolean,
  _discoveryID: string,
  mode: FocusSelectionMode,
  focusNeurons: readonly number[],
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
  weightMap?: Map<number, number>,
  totalWeight?: number,
  reason = "",
): FocusSelectionSummary {
  const neurons = focusNeurons.map((id) => ({
    id,
    weight: weightMap?.get(id),
  }));
  const summary: FocusSelectionSummary = {
    key: focusSelectionKey(focusNeurons),
    mode,
    reason,
    neurons,
    totalWeight,
  };
  if (loggingEnabled && mode === "weighted") {
    const preview = neurons.slice(0, Math.min(3, neurons.length)).map((
      entry,
    ) =>
      entry.weight !== undefined
        ? `${entry.id} (weight ${entry.weight.toFixed(4)})`
        : String(entry.id)
    ).join(", ");
    logFn(
      "info",
      `Weighted error x impact selection prioritised: ${preview}${
        neurons.length > 3 ? ", …" : ""
      }`,
    );
  }
  return summary;
}

/**
 * Writes focus selection analysis to a JSON file for debugging and validation.
 * Documents all candidate neurons, their metrics, and which were selected.
 */
export function writeFocusSelectionAnalysis(
  tempDir: string,
  discoveryID: string,
  loggingEnabled: boolean,
  neuronErrors: NeuronErrorInfo[],
  selectedIds: Set<number>,
  totalWeightedSum: number,
  selectionMethod: string,
  costOfGrowth: number,
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
  retryNumber?: number,
  weightConcentrationRatio?: number,
): void {
  try {
    const selectedSet = new Set(selectedIds);

    // Calculate all metrics for each candidate neuron
    const candidates: FocusNeuronCandidate[] = neuronErrors.map((neuron) => {
      const potentialErrorReduction = neuron.totalError * neuron.impact;
      const activationAffectPct = neuron.impact * 100;
      // Use squared weighting to match selection logic - strongly favours high-potential neurons
      const weightedScore = potentialErrorReduction * potentialErrorReduction;

      return {
        neuronId: neuron.id,
        totalError: neuron.totalError,
        impact: neuron.impact,
        potentialErrorReduction,
        activationAffectPct,
        weightedScore,
        selected: selectedSet.has(neuron.id),
      };
    });

    // Sort by potential error reduction (descending)
    candidates.sort((a, b) =>
      b.potentialErrorReduction - a.potentialErrorReduction
    );

    // Identify low-impact neurons (activation affect < costOfGrowth)
    const lowImpactThreshold = costOfGrowth;
    const lowImpactNeurons: LowImpactNeuron[] = neuronErrors
      .filter((n) => n.impact < lowImpactThreshold)
      .map((n) => ({
        neuronId: n.id,
        impact: n.impact,
        activationAffectPct: n.impact * 100,
        totalError: n.totalError,
        reason: `Impact ${
          n.impact.toFixed(6)
        } < cost of growth ${lowImpactThreshold}`,
      }))
      .sort((a, b) => a.impact - b.impact); // Sort by impact ascending (lowest first)

    const analysis: FocusSelectionAnalysis = {
      discoveryID,
      timestamp: Temporal.Now.instant().toString(),
      costOfGrowth,
      selectionMethod,
      totalCandidates: candidates.length,
      selectedCount: selectedIds.size,
      totalWeightedSum,
      weightConcentrationRatio,
      candidates,
      lowImpactNeurons,
      retryNumber,
    };

    const retryPart = retryNumber !== undefined ? `-retry-${retryNumber}` : "";
    const filename = `focus-selection${retryPart}.json`;
    const filepath = `${tempDir}/${filename}`;

    Deno.writeTextFileSync(filepath, JSON.stringify(analysis, null, 2));

    if (loggingEnabled) {
      logFn(
        "info",
        `Wrote focus selection analysis to ${filepath} (${candidates.length} candidates, ${selectedIds.size} selected, ${lowImpactNeurons.length} low-impact)`,
      );
    }
  } catch (error) {
    // Don't fail discovery if we can't write the analysis file
    getLogger().warn(
      `Failed to write focus selection analysis: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Selects neurons randomly, weighted by total error × impact, favouring neurons with higher
 * error and greater influence on outputs. Implements "roulette wheel" selection.
 *
 * @param count Number of neurons to select
 * @param costOfGrowth Cost threshold for filtering and weighting
 * @param allNeuronErrors All viable neurons with error info
 * @param getMaxOutputError Function to get cached max output error
 * @param logFn Logging function
 * @param mode Selection mode: "add" for adding structures, "remove" for removing structures
 */
export async function selectNeuronsWeightedByError(
  count: number,
  costOfGrowth: number,
  allNeuronErrors: NeuronErrorInfo[],
  getMaxOutputError: () => Promise<number>,
  loggingEnabled: boolean,
  discoveryID: string,
  tempDir: string,
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
  retryNumber?: number,
  mode: "add" | "remove" = "add",
  diversity: FocusDiversityOptions = {},
): Promise<{
  selected: number[];
  focusSelection: FocusSelectionSummary;
}> {
  const rng = getRandomNumberGenerator();
  assert(count > 0, "Count must be greater than 0");

  // Filter neurons based on mode
  const neuronErrors = mode === "add"
    ? allNeuronErrors.filter((n) => {
      const potentialErrorReduction = n.totalError * n.impact;
      return potentialErrorReduction >= costOfGrowth;
    })
    : allNeuronErrors.filter((n) => n.impact < costOfGrowth);

  if (loggingEnabled && neuronErrors.length < allNeuronErrors.length) {
    const filtered = allNeuronErrors.length - neuronErrors.length;
    const criteria = mode === "add"
      ? `potentialErrorReduction < costOfGrowth`
      : `impact >= costOfGrowth`;
    logFn(
      "debug",
      `Filtered ${filtered} neurons (${criteria}) for ${mode} mode, costOfGrowth=${costOfGrowth}`,
    );
  }

  if (neuronErrors.length === 0) {
    const reason = mode === "add"
      ? `potentialErrorReduction below costOfGrowth`
      : `impact >= costOfGrowth`;
    logFn(
      "warn",
      `All ${allNeuronErrors.length} neurons have ${reason} (${costOfGrowth}). No viable neurons for ${mode} mode.`,
    );
    return {
      selected: [],
      focusSelection: updateFocusSelectionSummary(
        loggingEnabled,
        discoveryID,
        "all",
        [],
        logFn,
        undefined,
        undefined,
        `no viable neurons for ${mode} mode`,
      ),
    };
  }

  const maxOutputError = await getMaxOutputError();
  const hasOutputCap = maxOutputError > 0;

  // EPSILON is set to costOfGrowth - the minimum meaningful improvement
  const EPSILON = costOfGrowth;

  // Use squared weighting relative to costOfGrowth to strongly favour viable improvements
  const rawWeights = neuronErrors.map((n) => {
    const potentialErrorReduction = n.totalError * n.impact;
    const netImprovement = mode === "add"
      ? potentialErrorReduction - costOfGrowth
      : costOfGrowth - n.impact;

    const clampedImprovement = Math.max(netImprovement, EPSILON);

    return {
      id: n.id,
      raw: clampedImprovement * clampedImprovement,
    };
  });
  const rawSum = rawWeights.reduce((sum, entry) => sum + entry.raw, 0);
  const capTotal = hasOutputCap
    ? Math.max(maxOutputError, EPSILON)
    : rawSum || EPSILON;
  const scale = hasOutputCap && rawSum > capTotal && rawSum > EPSILON
    ? capTotal / rawSum
    : 1;
  if (scale < 0.9999) {
    const scaleLabel = scale < 0.0001
      ? scale.toExponential(2)
      : scale.toFixed(4);
    logFn(
      "debug",
      `Scaling weighted errors by ${scaleLabel} to respect output error cap ${
        maxOutputError.toFixed(4)
      }`,
    );
  }
  const scaledValues = rawWeights.map((entry) => ({
    id: entry.id,
    weight: entry.raw * scale,
  }));

  // Issue #3074: Diversity floor. The squared weighting above lets a single
  // neuron capture almost all of the roulette weight on a plateaued network
  // (one neuron held ~98% on GRQ-3), so the nominally-distinct focus neurons
  // collapse onto one target. Water-fill each neuron's weight down to at most
  // a 1/N share of the total (N = candidate count) so no single neuron can
  // dominate the wheel, while preserving the relative ordering of the tail.
  const flooredWeights = applyDiversityFloor(
    scaledValues.map((entry) => entry.weight),
  );
  const weightedValues = scaledValues.map((entry, i) => ({
    id: entry.id,
    weight: flooredWeights[i],
  }));
  const totalWeightedSum = weightedValues.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );
  const weightConcentrationRatio = weightConcentration(flooredWeights);
  const preFloorConcentration = weightConcentration(
    scaledValues.map((entry) => entry.weight),
  );
  if (loggingEnabled && preFloorConcentration > weightConcentrationRatio) {
    logFn(
      "debug",
      `Diversity floor reduced weight concentration from ${
        preFloorConcentration.toFixed(4)
      } to ${weightConcentrationRatio.toFixed(4)} (N=${scaledValues.length})`,
    );
  }
  const weightMapAll = new Map(
    weightedValues.map((entry) => [entry.id, entry.weight]),
  );

  if (neuronErrors.length <= count) {
    const ids = neuronErrors.map((neuron) => neuron.id);
    const focusSelection = updateFocusSelectionSummary(
      loggingEnabled,
      discoveryID,
      "all",
      ids,
      logFn,
      weightMapAll,
      totalWeightedSum,
      "all viable neurons selected",
    );
    focusSelection.weightConcentrationRatio = weightConcentrationRatio;
    const selectedSet = new Set(ids);
    writeFocusSelectionAnalysis(
      tempDir,
      discoveryID,
      loggingEnabled,
      neuronErrors,
      selectedSet,
      totalWeightedSum,
      "all",
      costOfGrowth,
      logFn,
      retryNumber,
      weightConcentrationRatio,
    );
    return { selected: ids, focusSelection };
  }

  const selectedIds: Set<number> = new Set();

  // Guard against NaN, Infinity, or zero total weighted sum
  if (!Number.isFinite(totalWeightedSum)) {
    getLogger().error(
      `❌ CRITICAL ERROR: totalWeightedSum is ${totalWeightedSum} (NaN or Infinity). This indicates corrupt error/impact calculations in the discovery process!`,
    );
    getLogger().error(
      `   Neuron weighted summary: ${
        weightedValues.slice(0, 5).map((n) => `${n.id}: weight=${n.weight}`)
          .join(", ")
      }...`,
    );
    getLogger().warn(
      `   Falling back to random neuron selection to continue discovery`,
    );
    const shuffled = [...neuronErrors].sort(() => rng.random() - 0.5);
    const fallback = shuffled.slice(0, count).map((n) => n.id);
    const focusSelection = updateFocusSelectionSummary(
      loggingEnabled,
      discoveryID,
      "random",
      fallback,
      logFn,
      undefined,
      undefined,
      "random selection due to invalid total weight",
    );
    const fallbackSet = new Set(fallback);
    writeFocusSelectionAnalysis(
      tempDir,
      discoveryID,
      loggingEnabled,
      neuronErrors,
      fallbackSet,
      0,
      "random-fallback-nan",
      costOfGrowth,
      logFn,
      retryNumber,
    );
    return { selected: fallback, focusSelection };
  }

  if (totalWeightedSum <= 0) {
    getLogger().warn(
      `⚠️  WARNING: totalWeightedSum is ${totalWeightedSum} (zero or negative). All neurons have zero error × impact?`,
    );
    getLogger().warn(`   Falling back to random neuron selection`);
    const shuffled = [...neuronErrors].sort(() => rng.random() - 0.5);
    const fallback = shuffled.slice(0, count).map((n) => n.id);
    const focusSelection = updateFocusSelectionSummary(
      loggingEnabled,
      discoveryID,
      "random",
      fallback,
      logFn,
      undefined,
      undefined,
      "random selection due to zero total weight",
    );
    const fallbackSet = new Set(fallback);
    writeFocusSelectionAnalysis(
      tempDir,
      discoveryID,
      loggingEnabled,
      neuronErrors,
      fallbackSet,
      0,
      "random-fallback-zero",
      costOfGrowth,
      logFn,
      retryNumber,
    );
    return { selected: fallback, focusSelection };
  }

  // Issue #3074: Drought round-robin. When discovery has gone many epochs
  // without accepting a candidate the network is plateaued, and even the
  // diversity-floored roulette tends to keep re-sampling the same heavy
  // neurons. Switch to a deterministic round-robin across the top 3×count
  // ranked neurons, rotating the start offset by the drought length so
  // successive plateaued epochs cycle through distinct targets.
  const droughtThreshold = diversity.droughtThreshold ??
    DEFAULT_FOCUS_DROUGHT_THRESHOLD;
  const epochsSinceLastAccepted = diversity.epochsSinceLastAccepted ?? 0;
  if (epochsSinceLastAccepted > droughtThreshold) {
    // Rank to mirror the weighting logic: "add" favours the highest
    // error × impact, "remove" favours the lowest impact.
    const ranked = [...neuronErrors].sort((a, b) =>
      mode === "add"
        ? (b.totalError * b.impact) - (a.totalError * a.impact)
        : a.impact - b.impact
    );
    const poolSize = Math.min(ranked.length, count * 3);
    const offset = poolSize > 0 ? epochsSinceLastAccepted % poolSize : 0;
    const roundRobin: number[] = [];
    for (let i = 0; i < count && i < poolSize; i++) {
      roundRobin.push(ranked[(offset + i) % poolSize].id);
    }
    if (loggingEnabled) {
      logFn(
        "info",
        `Drought round-robin focus selection: epochsSinceLastAccepted=${epochsSinceLastAccepted} > threshold ${droughtThreshold}; rotating ${roundRobin.length} of top ${poolSize} ranked neurons (offset ${offset}).`,
      );
    }
    const focusSelection = updateFocusSelectionSummary(
      loggingEnabled,
      discoveryID,
      "round-robin",
      roundRobin,
      logFn,
      weightMapAll,
      totalWeightedSum,
      `drought round-robin (epochsSinceLastAccepted=${epochsSinceLastAccepted} > ${droughtThreshold})`,
    );
    focusSelection.weightConcentrationRatio = weightConcentrationRatio;
    writeFocusSelectionAnalysis(
      tempDir,
      discoveryID,
      loggingEnabled,
      neuronErrors,
      new Set(roundRobin),
      totalWeightedSum,
      "round-robin-drought",
      costOfGrowth,
      logFn,
      retryNumber,
      weightConcentrationRatio,
    );
    return { selected: roundRobin, focusSelection };
  }

  // Use while loop with max iterations to prevent infinite loops
  const maxIterations = Math.min(count, neuronErrors.length) * 100;
  let iterations = 0;
  let stallCount = 0;
  let lastSize = 0;
  const stallThreshold = Math.min(neuronErrors.length * 3, count * 5);

  while (selectedIds.size < count && iterations < maxIterations) {
    iterations++;
    const randValue = rng.random() * totalWeightedSum;
    let cumulativeWeight = 0;

    for (const weighted of weightedValues) {
      cumulativeWeight += weighted.weight;
      if (randValue <= cumulativeWeight) {
        selectedIds.add(weighted.id);
        break;
      }
    }

    if (selectedIds.size === lastSize) {
      stallCount++;
      if (stallCount > stallThreshold) {
        const unselected = neuronErrors
          .filter((n) => !selectedIds.has(n.id))
          .sort(() => rng.random() - 0.5);
        const needed = count - selectedIds.size;
        unselected.slice(0, needed).forEach((n) => selectedIds.add(n.id));
        break;
      }
    } else {
      stallCount = 0;
      lastSize = selectedIds.size;
    }
  }

  if (iterations >= maxIterations) {
    getLogger().error(
      `❌ ERROR: Selection reached max iterations (${maxIterations}), only selected ${selectedIds.size}/${count} neurons`,
    );
    getLogger().error(
      `   This should not happen with the hybrid approach. Please report this.`,
    );
    getLogger().error(
      `   totalWeightedSum: ${totalWeightedSum}, neuronErrors.length: ${neuronErrors.length}`,
    );
  }

  const selection = Array.from(selectedIds);
  const weightMap = new Map(
    weightedValues.map((n) => [n.id, n.weight]),
  );
  const focusSelection = updateFocusSelectionSummary(
    loggingEnabled,
    discoveryID,
    "weighted",
    selection,
    logFn,
    weightMap,
    totalWeightedSum,
    "error x impact weighting",
  );
  focusSelection.weightConcentrationRatio = weightConcentrationRatio;
  writeFocusSelectionAnalysis(
    tempDir,
    discoveryID,
    loggingEnabled,
    neuronErrors,
    selectedIds,
    totalWeightedSum,
    "weighted",
    costOfGrowth,
    logFn,
    retryNumber,
    weightConcentrationRatio,
  );

  return { selected: selection, focusSelection };
}

/**
 * Error-weighted neuron selection for discovery focus.
 *
 * Implements roulette wheel selection weighted by error × impact,
 * with fallback to random selection. Also provides focus selection
 * summary and analysis utilities.
 */
import { assert } from "@std/assert";
import { getLogger } from "../../utils/Logger.ts";
import { getRandomNumberGenerator } from "../../utils/RandomNumberGenerator.ts";
import type {
  FocusNeuronCandidate,
  FocusSelectionAnalysis,
  FocusSelectionMode,
  FocusSelectionSummary,
  LowImpactNeuron,
  NeuronErrorInfo,
} from "./DiscoverStructureTypes.ts";

/**
 * Generates a cache key for focus selection.
 */
export function focusSelectionKey(focusList: readonly string[]): string {
  return focusList.join("|");
}

/**
 * Updates the focus selection summary for debugging.
 */
export function updateFocusSelectionSummary(
  loggingEnabled: boolean,
  _discoveryID: string,
  mode: FocusSelectionMode,
  focusNeurons: readonly string[],
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
  weightMap?: Map<string, number>,
  totalWeight?: number,
  reason = "",
): FocusSelectionSummary {
  const neurons = focusNeurons.map((uuid) => ({
    uuid,
    weight: weightMap?.get(uuid),
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
        ? `${entry.uuid} (weight ${entry.weight.toFixed(4)})`
        : entry.uuid
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
  selectedUUIDs: Set<string>,
  totalWeightedSum: number,
  selectionMethod: string,
  costOfGrowth: number,
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
  retryNumber?: number,
): void {
  try {
    const selectedSet = new Set(selectedUUIDs);

    // Calculate all metrics for each candidate neuron
    const candidates: FocusNeuronCandidate[] = neuronErrors.map((neuron) => {
      const potentialErrorReduction = neuron.totalError * neuron.impact;
      const activationAffectPct = neuron.impact * 100;
      // Use squared weighting to match selection logic - strongly favours high-potential neurons
      const weightedScore = potentialErrorReduction * potentialErrorReduction;

      return {
        neuronUuid: neuron.uuid,
        totalError: neuron.totalError,
        impact: neuron.impact,
        potentialErrorReduction,
        activationAffectPct,
        weightedScore,
        selected: selectedSet.has(neuron.uuid),
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
        neuronUuid: n.uuid,
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
      timestamp: new Date().toISOString(),
      costOfGrowth,
      selectionMethod,
      totalCandidates: candidates.length,
      selectedCount: selectedUUIDs.size,
      totalWeightedSum,
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
        `Wrote focus selection analysis to ${filepath} (${candidates.length} candidates, ${selectedUUIDs.size} selected, ${lowImpactNeurons.length} low-impact)`,
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
): Promise<{
  selected: string[];
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
      uuid: n.uuid,
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
  const weightedValues = rawWeights.map((entry) => ({
    uuid: entry.uuid,
    weight: entry.raw * scale,
  }));
  const totalWeightedSum = weightedValues.reduce(
    (sum, entry) => sum + entry.weight,
    0,
  );
  const weightMapAll = new Map(
    weightedValues.map((entry) => [entry.uuid, entry.weight]),
  );

  if (neuronErrors.length <= count) {
    const uuids = neuronErrors.map((neuron) => neuron.uuid);
    const focusSelection = updateFocusSelectionSummary(
      loggingEnabled,
      discoveryID,
      "all",
      uuids,
      logFn,
      weightMapAll,
      totalWeightedSum,
      "all viable neurons selected",
    );
    const selectedSet = new Set(uuids);
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
    );
    return { selected: uuids, focusSelection };
  }

  const selectedUUIDs: Set<string> = new Set();

  // Guard against NaN, Infinity, or zero total weighted sum
  if (!Number.isFinite(totalWeightedSum)) {
    getLogger().error(
      `❌ CRITICAL ERROR: totalWeightedSum is ${totalWeightedSum} (NaN or Infinity). This indicates corrupt error/impact calculations in the discovery process!`,
    );
    getLogger().error(
      `   Neuron weighted summary: ${
        weightedValues.slice(0, 5).map((n) =>
          `${n.uuid.slice(-8)}: weight=${n.weight}`
        ).join(", ")
      }...`,
    );
    getLogger().warn(
      `   Falling back to random neuron selection to continue discovery`,
    );
    const shuffled = [...neuronErrors].sort(() => rng.random() - 0.5);
    const fallback = shuffled.slice(0, count).map((n) => n.uuid);
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
    const fallback = shuffled.slice(0, count).map((n) => n.uuid);
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

  // Use while loop with max iterations to prevent infinite loops
  const maxIterations = Math.min(count, neuronErrors.length) * 100;
  let iterations = 0;
  let stallCount = 0;
  let lastSize = 0;
  const stallThreshold = Math.min(neuronErrors.length * 3, count * 5);

  while (selectedUUIDs.size < count && iterations < maxIterations) {
    iterations++;
    const randValue = rng.random() * totalWeightedSum;
    let cumulativeWeight = 0;

    for (const weighted of weightedValues) {
      cumulativeWeight += weighted.weight;
      if (randValue <= cumulativeWeight) {
        selectedUUIDs.add(weighted.uuid);
        break;
      }
    }

    if (selectedUUIDs.size === lastSize) {
      stallCount++;
      if (stallCount > stallThreshold) {
        const unselected = neuronErrors
          .filter((n) => !selectedUUIDs.has(n.uuid))
          .sort(() => rng.random() - 0.5);
        const needed = count - selectedUUIDs.size;
        unselected.slice(0, needed).forEach((n) => selectedUUIDs.add(n.uuid));
        break;
      }
    } else {
      stallCount = 0;
      lastSize = selectedUUIDs.size;
    }
  }

  if (iterations >= maxIterations) {
    getLogger().error(
      `❌ ERROR: Selection reached max iterations (${maxIterations}), only selected ${selectedUUIDs.size}/${count} neurons`,
    );
    getLogger().error(
      `   This should not happen with the hybrid approach. Please report this.`,
    );
    getLogger().error(
      `   totalWeightedSum: ${totalWeightedSum}, neuronErrors.length: ${neuronErrors.length}`,
    );
  }

  const selection = Array.from(selectedUUIDs);
  const weightMap = new Map(
    weightedValues.map((n) => [n.uuid, n.weight]),
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
  writeFocusSelectionAnalysis(
    tempDir,
    discoveryID,
    loggingEnabled,
    neuronErrors,
    selectedUUIDs,
    totalWeightedSum,
    "weighted",
    costOfGrowth,
    logFn,
    retryNumber,
  );

  return { selected: selection, focusSelection };
}

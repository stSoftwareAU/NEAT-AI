/**
 * Focus neuron selection for DiscoverStructure.
 *
 * Issue #1472: Extract DiscoverStructure.ts into focused modules.
 *
 * Implements error-weighted roulette wheel selection for choosing which
 * neurons to analyse during discovery. Supports forced focus overrides,
 * Rust-based focus ranking, and fallback selection strategies.
 */
import { assert } from "@std/assert";
import type { Creature } from "../../Creature.ts";
import { getLogger } from "../../utils/Logger.ts";
import { getRandomNumberGenerator } from "../../utils/RandomNumberGenerator.ts";
import type {
  FocusNeuronCandidate,
  FocusSelectionAnalysis,
  FocusSelectionMode,
  FocusSelectionSummary,
  LowImpactNeuron,
  NeuronErrorInfo,
  NeuronScanStats,
} from "./DiscoverStructureTypes.ts";
import { fromRustRemovalCandidate } from "./DiscoverResult.ts";
import type { RemovalCandidate } from "./DiscoverResult.ts";
import { creatureToRustFormat } from "./RustDiscovery.ts";
import type { DiscoverStructureDeps } from "./DiscoverStructure.ts";
import { formatMillis } from "./DiscoverLogging.ts";

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
 * Lists neurons sorted by their total error, using Rust focus ranking with fallback.
 */
export function listViableNeurons(
  creature: Creature,
  recorded: boolean,
  parquetFilePath: string | null,
  deps: DiscoverStructureDeps,
  loggingEnabled: boolean,
  discoveryID: string,
  recordedNeuronTotalAbsError: Map<string, number>,
  calculateNeuronImpactFn: (neuronUUID: string) => number,
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
  targetCount?: number,
): {
  neurons: NeuronErrorInfo[];
  scanStats?: NeuronScanStats;
  cachedMaxOutputError?: { value: number; computedAt: number };
  removalCandidates?: RemovalCandidate[];
} {
  if (!recorded) {
    getLogger().warn("No recorded data to list neurons.");
    return { neurons: [] };
  }

  const rustResult = tryRustFocusRanking(
    creature,
    parquetFilePath,
    deps,
    loggingEnabled,
    discoveryID,
    logFn,
    targetCount,
  );
  if (rustResult && rustResult.neurons.length > 0) {
    return rustResult;
  }
  if (
    rustResult && rustResult.neurons.length === 0 &&
    recordedNeuronTotalAbsError.size > 0
  ) {
    logFn(
      "warn",
      "Rust focus ranking returned 0 neuron(s). Falling back to local recorded error aggregation for focus selection.",
    );
    return {
      neurons: fallbackViableNeuronsFromRecordedErrors(
        creature,
        recordedNeuronTotalAbsError,
        calculateNeuronImpactFn,
        targetCount,
      ),
      scanStats: rustResult.scanStats,
    };
  }
  if (!rustResult && recordedNeuronTotalAbsError.size > 0) {
    logFn(
      "warn",
      "Rust focus ranking unavailable. Falling back to local recorded error aggregation for focus selection.",
    );
    return {
      neurons: fallbackViableNeuronsFromRecordedErrors(
        creature,
        recordedNeuronTotalAbsError,
        calculateNeuronImpactFn,
        targetCount,
      ),
    };
  }

  // Rust discovery is required - no fallback
  getLogger().error(
    `❌ CRITICAL: Rust focus ranking failed. Discovery cannot proceed without Rust analysis.`,
  );
  getLogger().error(
    `   Ensure NEAT-AI-Discovery Rust library is properly built and available.`,
  );
  return { neurons: [] };
}

/**
 * Fallback using locally accumulated error data.
 */
function fallbackViableNeuronsFromRecordedErrors(
  creature: Creature,
  recordedNeuronTotalAbsError: Map<string, number>,
  calculateNeuronImpactFn: (neuronUUID: string) => number,
  targetCount?: number,
): NeuronErrorInfo[] {
  const results: NeuronErrorInfo[] = [];
  for (const neuron of creature.neurons) {
    if (neuron.type === "input" || neuron.type === "constant") {
      continue;
    }
    const totalError = recordedNeuronTotalAbsError.get(neuron.uuid) ?? 0;
    const impact = calculateNeuronImpactFn(neuron.uuid);
    results.push({
      uuid: neuron.uuid,
      totalError: Number.isFinite(totalError) ? totalError : 0,
      impact: Number.isFinite(impact) ? impact : 0,
    });
  }
  results.sort((a, b) => b.totalError - a.totalError);
  if (targetCount && results.length > targetCount) {
    return results.slice(0, targetCount);
  }
  return results;
}

/**
 * Calls Rust `rankFocusNeurons` FFI, handles diagnostics and removal candidates.
 */
function tryRustFocusRanking(
  creature: Creature,
  parquetFilePath: string | null,
  deps: DiscoverStructureDeps,
  loggingEnabled: boolean,
  _discoveryID: string,
  logFn: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    details?: unknown,
  ) => void,
  targetCount?: number,
): {
  neurons: NeuronErrorInfo[];
  scanStats?: NeuronScanStats;
  cachedMaxOutputError?: { value: number; computedAt: number };
  removalCandidates?: RemovalCandidate[];
} | undefined {
  if (
    !parquetFilePath ||
    !deps.rankFocusNeurons ||
    !deps.isRustDiscoveryEnabled()
  ) {
    return undefined;
  }

  try {
    const rustCreature = creatureToRustFormat(creature.exportJSON());
    const maxResults = Math.max(
      targetCount ?? creature.neurons.length,
      64,
    );

    // Get parquet file size for diagnostics
    let parquetFileSizeStr = "unknown";
    try {
      const fileInfo = Deno.statSync(parquetFilePath);
      const mb = (fileInfo.size / (1024 * 1024)).toFixed(2);
      parquetFileSizeStr = `${mb} MB (${fileInfo.size.toLocaleString()} bytes)`;
    } catch {
      // File might not exist or be accessible, ignore
    }

    const nonInputNeurons = creature.neurons.filter(
      (n) => n.type !== "input",
    ).length;
    const totalNeurons = creature.neurons.length;
    const totalSynapses = creature.synapses.length;

    if (loggingEnabled) {
      logFn(
        "debug",
        `Rust focus ranking: ${nonInputNeurons} non-input neurons, ${totalNeurons} total neurons, ${totalSynapses} synapses, parquet file: ${parquetFileSizeStr}`,
      );
    }

    const rustRankStart = Date.now();
    const result = deps.rankFocusNeurons({
      parquetFile: parquetFilePath,
      creature: rustCreature,
      maxResults,
    });
    const rustRankDuration = Date.now() - rustRankStart;

    if (!result || !result.success || !result.neurons) {
      if (loggingEnabled && result?.error) {
        logFn(
          "debug",
          `Rust focus ranking failed after ${
            formatMillis(rustRankDuration)
          }: ${result.error}`,
        );
      }
      return undefined;
    }

    const cachedMaxOutputError = result.maxOutputError !== undefined
      ? { value: result.maxOutputError, computedAt: Date.now() }
      : undefined;

    const scanStats: NeuronScanStats = {
      processed: result.processedNeurons ?? result.neurons.length,
      total: result.totalNeurons ?? creature.neurons.length,
      durationMs: result.durationMs ?? 0,
      timedOut: false,
    };

    if (loggingEnabled) {
      const duration = result.durationMs !== undefined
        ? formatMillis(result.durationMs)
        : "unknown time";
      const scannedInfo = result.processedNeurons !== undefined &&
          result.totalNeurons !== undefined
        ? ` Scanned ${result.processedNeurons}/${result.totalNeurons} neurons.`
        : "";
      logFn(
        "debug",
        `Rust focus ranking returned ${result.neurons.length} neuron(s) in ${duration}.${scannedInfo}`,
      );
    }

    // Capture low-impact removal candidates from Rust
    let removalCandidates: RemovalCandidate[] | undefined;
    if (result.removalCandidates && result.removalCandidates.length > 0) {
      removalCandidates = result.removalCandidates.map(
        fromRustRemovalCandidate,
      );
      if (loggingEnabled) {
        logFn(
          "info",
          `Found ${result.removalCandidates.length} removal candidate${
            result.removalCandidates.length === 1 ? "" : "s"
          } (impact below costOfGrowth)`,
        );
      }
    }

    const neurons = result.neurons.map((entry) => ({
      uuid: entry.neuronUuid,
      totalError: entry.totalError,
      impact: entry.impact,
    }));

    return { neurons, scanStats, cachedMaxOutputError, removalCandidates };
  } catch (error) {
    if (loggingEnabled) {
      const message = error instanceof Error ? error.message : String(error);
      logFn("debug", `Rust focus ranking threw error: ${message}`);
    }
    return undefined;
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

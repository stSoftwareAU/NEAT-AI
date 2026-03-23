/**
 * Focus neuron ranking using Rust FFI with local fallback.
 *
 * Lists and ranks neurons by error magnitude and impact, using Rust
 * GPU-accelerated ranking when available, with fallback to local
 * recorded error aggregation.
 */
import type { Creature } from "../../Creature.ts";
import { getLogger } from "../../utils/Logger.ts";
import type {
  NeuronErrorInfo,
  NeuronScanStats,
} from "./DiscoverStructureTypes.ts";
import { fromRustRemovalCandidate } from "./DiscoverResult.ts";
import type { RemovalCandidate } from "./DiscoverResult.ts";
import { creatureToRustFormat } from "./RustDiscovery.ts";
import type { DiscoverStructureDeps } from "./DiscoverStructure.ts";
import { formatMillis } from "./DiscoverLogging.ts";

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
  recordedNeuronTotalAbsError: Map<number, number>,
  calculateNeuronImpactFn: (neuronId: number) => number,
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
  recordedNeuronTotalAbsError: Map<number, number>,
  calculateNeuronImpactFn: (neuronId: number) => number,
  targetCount?: number,
): NeuronErrorInfo[] {
  const results: NeuronErrorInfo[] = [];
  for (const neuron of creature.neurons) {
    if (neuron.type === "input" || neuron.type === "constant") {
      continue;
    }
    const totalError = recordedNeuronTotalAbsError.get(neuron.id) ?? 0;
    const impact = calculateNeuronImpactFn(neuron.id);
    results.push({
      id: neuron.id,
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
      id: Number(entry.neuronUuid),
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

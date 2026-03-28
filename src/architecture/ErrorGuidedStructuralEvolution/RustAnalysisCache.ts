/**
 * Rust combined analysis caching for DiscoverStructure.
 *
 * Issue #1472: Extract DiscoverStructure.ts into focused modules.
 *
 * Manages the cache for combined Rust parallel analysis results,
 * handling cache key generation, cache lookup, and cache population.
 */
import type { Creature } from "../../Creature.ts";
import { CreatureErrorImpactEstimator } from "../../discovery/NeuronErrorImpactEstimator.ts";
import type {
  RustAnalyzeAllResult,
  RustAnalyzeNeuronsResult,
  RustAnalyzeSynapsesResult,
  RustParallelAnalysisInput,
  RustParallelAnalysisResult,
} from "./RustDiscovery.ts";
import { creatureToRustFormat } from "./RustDiscovery.ts";
import type { DiscoverStructureDeps } from "./DiscoverStructure.ts";
import { buildRuntimeIdToWireMap } from "./DiscoveryWireIdentity.ts";

/**
 * Cached combined analysis result.
 */
export interface CombinedAnalysisCache {
  key: string;
  includeSynapse: boolean;
  includeNeuron: boolean;
  result: RustAnalyzeAllResult;
}

/**
 * Builds a cache key from parquet path and focus list.
 */
export function buildCombinedAnalysisKey(
  parquetFilePath: string | null,
  focusList: readonly number[],
): string {
  const pathKey = parquetFilePath ?? "none";
  return `${pathKey}|${JSON.stringify(focusList)}`;
}

/**
 * Reads from the combined analysis cache, returns undefined on miss.
 */
export function readRustCombinedAnalysis(
  cache: CombinedAnalysisCache | undefined,
  parquetFilePath: string | null,
  focusList: number[],
  needsSynapse: boolean,
  needsNeuron: boolean,
): RustAnalyzeAllResult | undefined {
  if (!cache) {
    return undefined;
  }
  if (cache.key !== buildCombinedAnalysisKey(parquetFilePath, focusList)) {
    return undefined;
  }
  if (needsSynapse && !cache.includeSynapse) {
    return undefined;
  }
  if (needsNeuron && !cache.includeNeuron) {
    return undefined;
  }
  return cache.result;
}

/**
 * Calls Rust `analyzeParallel` if cache miss, returns the result and new cache entry.
 */
export function ensureRustCombinedAnalysis(
  creature: Creature,
  parquetFilePath: string | null,
  deps: DiscoverStructureDeps,
  cache: CombinedAnalysisCache | undefined,
  analysisDeadlineMs: number | undefined,
  focusList: number[],
  includeSynapse: boolean,
  includeNeuron: boolean,
  logRustAnalysisUnavailableFn: (
    scope: "synapse" | "neuron",
    focusList: number[],
    reason: string,
  ) => void,
): {
  result: RustAnalyzeAllResult | undefined;
  cache: CombinedAnalysisCache | undefined;
} {
  if (!parquetFilePath || !deps.isRustDiscoveryEnabled()) {
    return { result: undefined, cache };
  }

  if (!includeSynapse && !includeNeuron) {
    return { result: undefined, cache };
  }

  const cacheKey = buildCombinedAnalysisKey(parquetFilePath, focusList);
  if (
    cache &&
    cache.key === cacheKey &&
    (!includeSynapse || cache.includeSynapse) &&
    (!includeNeuron || cache.includeNeuron)
  ) {
    return { result: cache.result, cache };
  }

  const rustCreature = creatureToRustFormat(creature.exportJSON());
  const idToWire = buildRuntimeIdToWireMap(creature);
  const focusWireUuids = focusList.map((id) => idToWire.get(id) ?? String(id));

  // Calculate each focus neuron's share of the creature's total error.
  const impactEstimator = new CreatureErrorImpactEstimator(creature);
  const focusNeuronErrorShares: Record<string, number> = {};
  for (let i = 0; i < focusList.length; i++) {
    focusNeuronErrorShares[focusWireUuids[i]] = impactEstimator.getNeuronShare(
      focusList[i],
    );
  }

  const parallelInput: RustParallelAnalysisInput = {
    parquetFile: parquetFilePath,
    creature: rustCreature,
    focusNeurons: focusWireUuids,
    maxSynapseCandidates: includeSynapse
      ? Math.max(50, focusList.length * 10)
      : undefined,
    maxNeuronCandidates: includeNeuron
      ? Math.max(25, focusList.length * 5)
      : undefined,
    requireGpu: false,
    analysisDeadlineMs,
    focusNeuronErrorShares,
  };

  const parallelResult = deps.analyzeParallel(parallelInput);
  if (!parallelResult || !parallelResult.success) {
    const reason = parallelResult?.error ??
      "analysis did not return a result";
    if (includeSynapse) {
      logRustAnalysisUnavailableFn("synapse", focusList, reason);
    }
    if (includeNeuron) {
      logRustAnalysisUnavailableFn("neuron", focusList, reason);
    }
    return { result: undefined, cache: undefined };
  }
  const converted = convertParallelAnalysisResult(parallelResult);
  const newCache: CombinedAnalysisCache = {
    key: cacheKey,
    includeSynapse,
    includeNeuron,
    result: converted,
  };
  return { result: converted, cache: newCache };
}

/**
 * Converts RustParallelAnalysisResult to RustAnalyzeAllResult.
 */
export function convertParallelAnalysisResult(
  parallel: RustParallelAnalysisResult,
): RustAnalyzeAllResult {
  const hasSynapsePayload = Boolean(
    parallel.helpfulSynapses?.length ||
      parallel.harmfulSynapses?.length ||
      parallel.synapseDiagnostics?.length,
  );
  const hasNeuronPayload = Boolean(
    parallel.helpfulNeurons?.length ||
      parallel.coordinatedStructuralCandidates?.length ||
      parallel.neuronDiagnostics?.length,
  );

  const synapseResult: RustAnalyzeSynapsesResult | undefined = hasSynapsePayload
    ? {
      success: true,
      gpuUsed: parallel.synapseGpuUsed,
      metadata: parallel.synapseMetadata,
      helpfulSynapses: parallel.helpfulSynapses,
      harmfulSynapses: parallel.harmfulSynapses,
      diagnostics: parallel.synapseDiagnostics,
    }
    : undefined;
  const neuronResult: RustAnalyzeNeuronsResult | undefined = hasNeuronPayload
    ? {
      success: true,
      gpuUsed: parallel.neuronGpuUsed,
      metadata: parallel.neuronMetadata,
      helpfulNeurons: parallel.helpfulNeurons,
      coordinatedStructuralCandidates: parallel.coordinatedStructuralCandidates,
      diagnostics: parallel.neuronDiagnostics,
    }
    : undefined;

  return {
    success: parallel.success,
    synapse: synapseResult,
    neuron: neuronResult,
    error: parallel.error,
  };
}

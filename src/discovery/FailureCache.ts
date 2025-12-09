/**
 * Discovery Failure Cache Module
 *
 * Provides caching for discovery candidates that failed to improve the creature's score.
 * This prevents re-evaluating the same failing candidates when the training dataset
 * hasn't changed.
 *
 * Cache keys are based on:
 * - Change type (add-synapses, add-neurons, remove-low-impact, etc.)
 * - Structural signature (neuron UUIDs, synapse connections)
 * - Weight/bias magnitude (using exponent only, so similar weights map to same key)
 *
 * Enhanced Diagnostics:
 * Set NEAT_AI_TRACE_PREDICTION=1 to enable detailed prediction tracing during evaluation.
 * This logs sample-level contribution calculations to help debug prediction inversions.
 *
 * @module FailureCache
 */

import { dirname } from "@std/path/dirname";
import { join } from "@std/path/join";
import type { DiscoveryCandidate } from "./DiscoveryCandidates.ts";
import type { Creature } from "../Creature.ts";

/** Check if prediction tracing is enabled */
export function isPredictionTracingEnabled(): boolean {
  try {
    return Deno.env.get("NEAT_AI_TRACE_PREDICTION") === "1";
  } catch {
    return false;
  }
}

/** Sample diagnostic information for understanding prediction vs actual results */
export interface SampleDiagnostic {
  /** Index of this sample in the dataset */
  sampleIndex?: number;
  /** Activation of the source neuron for this sample */
  sourceActivation: number;
  /** Average error at the target neuron for this sample */
  avgError: number;
  /** Expected target value (from training data) */
  targetValue?: number;
  /** Actual activation at the target neuron before change */
  targetActivation?: number;
  /** Computed contribution of new neuron/synapse for this sample */
  computedContribution?: number;
}

/** Prediction details from the Rust candidate analysis */
export interface PredictionDetails {
  /** Incoming weight (source -> new neuron, for add-neurons) */
  incomingWeight?: number;
  /** Outgoing weight (new neuron -> target, for add-neurons) */
  outgoingWeight?: number;
  /** Weight for synapse candidates */
  weight?: number;
  /** Bias of the new neuron */
  bias?: number;
  /** Squash function used */
  squash?: string;
  /** Expected improvement percentage from Rust */
  expectedImprovementPct?: number;
  /** Number of samples where improvement was predicted */
  improvedCount?: number;
  /** Total samples analysed */
  totalCount?: number;
  /** Example contribution calculation for a typical sample */
  exampleContribution?: {
    sourceActivation: number;
    preActivation: number;
    postActivation: number;
    contribution: number;
  };
}

/** Error comparison details for debugging prediction inversions */
export interface ErrorComparison {
  /** Original MSE before candidate was applied */
  originalMSE: number;
  /** MSE after candidate was applied */
  candidateMSE: number;
  /** Actual error reduction (originalMSE - candidateMSE, positive = improvement) */
  actualErrorReduction: number;
  /** Actual error reduction as percentage */
  actualErrorReductionPct: number;
  /** Expected error reduction from Rust prediction */
  expectedErrorReduction?: number;
  /** Expected error reduction as percentage from Rust */
  expectedErrorReductionPct?: number;
  /** Formula used for error calculation */
  errorFormula: string;
  /** Whether prediction direction was correct */
  predictionDirectionCorrect?: boolean;
}

/** Information about the target neuron */
export interface TargetNeuronInfo {
  /** UUID of the target neuron */
  uuid: string;
  /** Squash function of the target neuron */
  squash: string;
  /** Whether the neuron is at saturation (|activation| > 0.95 for bounded activations) */
  isSaturated?: boolean;
  /** Mean activation across samples */
  meanActivation?: number;
  /** Activation variance */
  activationVariance?: number;
  /** Mean error at this neuron */
  meanError?: number;
  /** Error variance */
  errorVariance?: number;
}

/** Metadata stored alongside cached failures for debugging/analysis */
export interface FailureMetadata {
  originalScore: number;
  candidateScore: number;
  scoreDelta: number;
  error: number;
  /** Re-scored error of the original creature (without candidate changes applied) */
  originalError?: number;
  timestamp?: string;

  // Enhanced diagnostic fields for debugging prediction inversions

  /** Diagnostics for first few samples used in prediction */
  sampleDiagnostics?: SampleDiagnostic[];
  /** Prediction details from Rust candidate */
  predictionDetails?: PredictionDetails;
  /** Error comparison showing expected vs actual */
  errorComparison?: ErrorComparison;
  /** Information about the target neuron */
  targetNeuronInfo?: TargetNeuronInfo;
}

/** Represents the actual neuron state in the creature after changes were applied */
export interface ActualNeuronState {
  uuid: string;
  squash: string;
  bias: number;
}

/** Represents the actual synapse state in the creature after changes were applied */
export interface ActualSynapseState {
  fromUUID: string;
  toUUID: string;
  weight: number;
}

/** Records what actually changed in the creature (for verification against Rust request) */
export interface ActualCreatureChange {
  /** Neurons that were added (with their actual values after fix()) */
  addedNeurons?: ActualNeuronState[];
  /** Synapses connected to added neurons (with actual weights after fix()) */
  addedSynapses?: ActualSynapseState[];
  /** Neurons that were removed */
  removedNeuronUUIDs?: string[];
  /** Synapses that were removed */
  removedSynapseKeys?: string[];
}

/**
 * Extracts the exponent from a number's scientific notation.
 * This allows similar weights (same order of magnitude) to map to the same cache key.
 *
 * @param value - The number to extract the exponent from
 * @returns The exponent (e.g., 0.001 → -3, 100 → 2)
 */
export function extractExponent(value: number): number {
  if (value === 0) return -999; // Sentinel for zero
  const absValue = Math.abs(value);
  return Math.floor(Math.log10(absValue));
}

/**
 * Formats a weight/bias using only its exponent for cache key generation.
 * This ensures that weights with the same order of magnitude produce the same key.
 *
 * @param weight - The weight or bias value
 * @returns A string like "e-3" or "e2"
 */
export function formatWeight(weight: number): string {
  const exp = extractExponent(weight);
  return `e${exp}`;
}

/**
 * Builds a deterministic cache key for a discovery candidate.
 *
 * The key incorporates:
 * - Change type
 * - For neuron removal: just the neuron UUID (simple, fast lookup)
 * - For synapse removal: just the from/to UUIDs
 * - For other types: structural information and weight magnitudes
 *
 * @param candidate - The discovery candidate to generate a key for
 * @returns A string suitable for use as a cache filename
 */
export function buildCacheKey(candidate: DiscoveryCandidate): string {
  const parts: string[] = [candidate.change.type];

  // Handle different candidate types
  switch (candidate.change.type) {
    case "add-neurons": {
      // For add-neurons, use neuronDetails if available
      const details = candidate.change.neuronDetails;
      if (details) {
        parts.push(
          details.fromNeuronUUID,
          details.toNeuronUUID,
          details.squash,
          formatWeight(details.incomingWeight),
          formatWeight(details.outgoingWeight),
          formatWeight(details.bias),
        );
      } else {
        // Fallback: use creature structure
        parts.push(buildStructuralSignature(candidate));
      }
      break;
    }

    case "remove-low-impact":
    case "remove-neuron": {
      // For neuron removal, prefer the neuron UUID from description.
      // If removal failed once, it won't succeed until the creature structure changes
      // significantly (at which point the cache should be cleared anyway).
      const uuidMatch = candidate.change.description?.match(
        /neuron\s+([a-zA-Z0-9_-]+)/i,
      );
      if (uuidMatch) {
        parts.push(uuidMatch[1]);
      } else {
        // Fallback: use structural signature to avoid cache collisions
        parts.push(buildStructuralSignature(candidate));
      }
      break;
    }

    case "remove-synapse": {
      // For synapse removal, use from/to UUIDs from synapseDetails.
      // synapseDetails is always set for remove-synapse candidates created by
      // buildDiscoveryCandidates - assert to catch any future code changes.
      const synapseDetails = candidate.change.synapseDetails;
      if (!synapseDetails) {
        throw new Error(
          "remove-synapse candidate missing synapseDetails - this indicates a bug",
        );
      }
      parts.push(synapseDetails.fromNeuronUUID, synapseDetails.toNeuronUUID);
      break;
    }

    case "change-squash": {
      // For squash changes, include the squash function names from description
      // and a structural signature
      parts.push(buildStructuralSignature(candidate));
      break;
    }

    case "add-synapses":
    default: {
      // For synapses and other types, use structural signature
      parts.push(buildStructuralSignature(candidate));
      break;
    }
  }

  // Create a safe filename from the key parts
  return sanitiseForFilename(parts.join("_"));
}

/**
 * Builds a structural signature from the creature's neurons and synapses.
 * Uses exponents for weights/biases to group similar structures together.
 *
 * Includes both hidden and output neurons (sorted by UUID for determinism).
 * Input neurons are excluded as they have no squash/bias.
 */
function buildStructuralSignature(candidate: DiscoveryCandidate): string {
  const exported = candidate.creature.exportJSON();
  const sigParts: string[] = [];

  // Include neuron signatures (UUID, squash, bias exponent)
  // Filter to hidden and output neurons, then sort by UUID for determinism
  const relevantNeurons = exported.neurons
    .filter((n) => n.type === "hidden" || n.type === "output")
    .sort((a, b) => a.uuid.localeCompare(b.uuid));

  for (const neuron of relevantNeurons) {
    sigParts.push(
      `n:${neuron.uuid}:${neuron.squash}:${formatWeight(neuron.bias)}`,
    );
  }

  // Include synapse signatures (from→to, weight exponent)
  // Sort for determinism
  const sortedSynapses = [...exported.synapses].sort((a, b) => {
    const keyA = `${a.fromUUID}->${a.toUUID}`;
    const keyB = `${b.fromUUID}->${b.toUUID}`;
    return keyA.localeCompare(keyB);
  });

  for (const synapse of sortedSynapses) {
    sigParts.push(
      `s:${synapse.fromUUID}->${synapse.toUUID}:${
        formatWeight(synapse.weight)
      }`,
    );
  }

  return sigParts.join("|");
}

/**
 * Converts a string to a safe filename by replacing invalid characters.
 */
function sanitiseForFilename(value: string): string {
  // Replace characters not allowed in filenames with underscores
  // Keep alphanumeric, hyphens, underscores, and dots
  return value
    .replace(/[^a-zA-Z0-9_\-.]/g, "_")
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_|_$/g, "") // Remove leading/trailing underscores
    .slice(0, 200); // Limit length for filesystem compatibility
}

/**
 * Gets the cache file path for a candidate.
 */
function getCacheFilePath(
  cacheDir: string,
  candidate: DiscoveryCandidate,
): string {
  const key = buildCacheKey(candidate);
  const typeDir = candidate.change.type;
  return join(cacheDir, typeDir, `${key}.json`);
}

/**
 * Extracts the actual changes made to a creature by comparing with the base creature.
 * This allows verification that the TypeScript side correctly implemented what Rust requested.
 *
 * @param baseCreature - The original creature before changes
 * @param candidateCreature - The creature after changes were applied
 * @returns The actual changes made, or undefined if creatures are identical
 */
export function extractActualCreatureChanges(
  baseCreature: Creature,
  candidateCreature: Creature,
): ActualCreatureChange | undefined {
  const baseJSON = baseCreature.exportJSON();
  const candidateJSON = candidateCreature.exportJSON();

  // Build sets for comparison
  const baseNeuronUUIDs = new Set(baseJSON.neurons.map((n) => n.uuid));
  const candidateNeuronUUIDs = new Set(
    candidateJSON.neurons.map((n) => n.uuid),
  );

  const baseSynapseKeys = new Set(
    baseJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
  );
  const candidateSynapseKeys = new Set(
    candidateJSON.synapses.map((s) => `${s.fromUUID}->${s.toUUID}`),
  );

  // Find added neurons (in candidate but not in base)
  const addedNeurons: ActualNeuronState[] = [];
  for (const neuron of candidateJSON.neurons) {
    if (
      !baseNeuronUUIDs.has(neuron.uuid) &&
      neuron.type === "hidden" &&
      neuron.squash // Skip neurons without squash (shouldn't happen for hidden)
    ) {
      addedNeurons.push({
        uuid: neuron.uuid,
        squash: neuron.squash,
        bias: neuron.bias,
      });
    }
  }

  // Find added synapses (in candidate but not in base)
  const addedSynapses: ActualSynapseState[] = [];
  for (const synapse of candidateJSON.synapses) {
    const key = `${synapse.fromUUID}->${synapse.toUUID}`;
    if (!baseSynapseKeys.has(key)) {
      addedSynapses.push({
        fromUUID: synapse.fromUUID,
        toUUID: synapse.toUUID,
        weight: synapse.weight,
      });
    }
  }

  // Find removed neurons (in base but not in candidate)
  const removedNeuronUUIDs: string[] = [];
  for (const neuron of baseJSON.neurons) {
    if (!candidateNeuronUUIDs.has(neuron.uuid) && neuron.type === "hidden") {
      removedNeuronUUIDs.push(neuron.uuid);
    }
  }

  // Find removed synapses (in base but not in candidate)
  const removedSynapseKeys: string[] = [];
  for (const synapse of baseJSON.synapses) {
    const key = `${synapse.fromUUID}->${synapse.toUUID}`;
    if (!candidateSynapseKeys.has(key)) {
      removedSynapseKeys.push(key);
    }
  }

  // Return undefined if nothing changed
  if (
    addedNeurons.length === 0 &&
    addedSynapses.length === 0 &&
    removedNeuronUUIDs.length === 0 &&
    removedSynapseKeys.length === 0
  ) {
    return undefined;
  }

  return {
    addedNeurons: addedNeurons.length > 0 ? addedNeurons : undefined,
    addedSynapses: addedSynapses.length > 0 ? addedSynapses : undefined,
    removedNeuronUUIDs: removedNeuronUUIDs.length > 0
      ? removedNeuronUUIDs
      : undefined,
    removedSynapseKeys: removedSynapseKeys.length > 0
      ? removedSynapseKeys
      : undefined,
  };
}

/**
 * Extracts prediction details from a discovery candidate for debugging.
 * This provides the Rust-side prediction data that can be compared against actual results.
 *
 * @param candidate - The discovery candidate to extract details from
 * @returns PredictionDetails if relevant data is available
 */
export function extractPredictionDetails(
  candidate: DiscoveryCandidate,
): PredictionDetails | undefined {
  const change = candidate.change;

  // For add-neurons candidates, extract from neuronDetails
  if (change.type === "add-neurons" && change.neuronDetails) {
    const details = change.neuronDetails;
    return {
      incomingWeight: details.incomingWeight,
      outgoingWeight: details.outgoingWeight,
      bias: details.bias,
      squash: details.squash,
      expectedImprovementPct: change.expectedErrorReduction !== undefined
        ? change.expectedErrorReduction * 100
        : undefined,
    };
  }

  // For add-synapses candidates, we need to look at the creature's synapses
  if (change.type === "add-synapses") {
    return {
      expectedImprovementPct: change.expectedErrorReduction !== undefined
        ? change.expectedErrorReduction * 100
        : undefined,
      totalCount: change.sampleSize,
    };
  }

  // For change-squash candidates
  if (change.type === "change-squash") {
    return {
      expectedImprovementPct: change.expectedErrorReduction !== undefined
        ? change.expectedErrorReduction * 100
        : undefined,
    };
  }

  return undefined;
}

/**
 * Extracts target neuron information from a candidate creature.
 *
 * @param candidate - The discovery candidate
 * @param baseCreature - The base creature before modifications
 * @returns TargetNeuronInfo if a target neuron can be identified
 */
export function extractTargetNeuronInfo(
  candidate: DiscoveryCandidate,
  baseCreature: Creature,
): TargetNeuronInfo | undefined {
  const change = candidate.change;
  let targetUUID: string | undefined;

  // Identify target neuron based on change type
  if (change.type === "add-neurons" && change.neuronDetails) {
    targetUUID = change.neuronDetails.toNeuronUUID;
  } else if (change.type === "add-synapses") {
    // For synapses, extract from description if possible
    const toMatch = change.description?.match(/-> ([a-zA-Z0-9_-]+)/);
    if (toMatch) {
      targetUUID = toMatch[1];
    }
  }

  if (!targetUUID) return undefined;

  // Find the neuron in the base creature.
  // Note: For add-synapses candidates, targetUUID may be a shortID (last 8 chars)
  // extracted from the description, so we use endsWith() for matching.
  const neuron = baseCreature.neurons.find((n) =>
    n.uuid === targetUUID || n.uuid?.endsWith(targetUUID)
  );
  if (!neuron) return undefined;

  const squashName = neuron.squash ?? "IDENTITY";

  return {
    uuid: neuron.uuid ?? targetUUID, // Return full UUID from found neuron
    squash: squashName,
    // Note: Saturation and stats would need runtime activation data
    // which we don't have access to in this context
  };
}

/**
 * Builds error comparison details from metadata.
 *
 * @param metadata - The failure metadata
 * @param expectedErrorReduction - Expected error reduction from candidate
 * @returns ErrorComparison details
 */
export function buildErrorComparison(
  metadata: FailureMetadata,
  expectedErrorReduction?: number,
): ErrorComparison | undefined {
  if (metadata.originalError === undefined) return undefined;

  const originalMSE = metadata.originalError;
  const candidateMSE = metadata.error;
  const actualErrorReduction = originalMSE - candidateMSE;
  const actualErrorReductionPct = originalMSE === 0
    ? (candidateMSE === 0 ? 0 : -100)
    : (actualErrorReduction / originalMSE) * 100;

  // Determine if prediction direction was correct
  let predictionDirectionCorrect: boolean | undefined;
  if (expectedErrorReduction !== undefined) {
    const predictedImprovement = expectedErrorReduction > 0;
    const actualImprovement = actualErrorReduction > 0;
    predictionDirectionCorrect = predictedImprovement === actualImprovement;
  }

  return {
    originalMSE,
    candidateMSE,
    actualErrorReduction,
    actualErrorReductionPct,
    expectedErrorReduction,
    expectedErrorReductionPct: expectedErrorReduction !== undefined
      ? expectedErrorReduction * 100
      : undefined,
    errorFormula: "MSE = (1/n) * Σ(predicted - actual)²",
    predictionDirectionCorrect,
  };
}

/**
 * Logs detailed prediction trace when NEAT_AI_TRACE_PREDICTION=1 is set.
 *
 * @param candidate - The candidate being traced
 * @param metadata - The failure metadata
 * @param cacheEntry - The cache entry being written
 */
export function logPredictionTrace(
  candidate: DiscoveryCandidate,
  metadata: FailureMetadata,
  // deno-lint-ignore no-explicit-any
  cacheEntry: Record<string, any>,
): void {
  if (!isPredictionTracingEnabled()) return;

  console.info("=".repeat(80));
  console.info("[PREDICTION TRACE] Candidate evaluation details");
  console.info("=".repeat(80));
  console.info(`Change Type: ${candidate.change.type}`);
  console.info(`Description: ${candidate.change.description}`);
  console.info("");

  // Log score comparison from metadata
  console.info("--- Score Comparison ---");
  console.info(`Original Score:    ${metadata.originalScore.toPrecision(8)}`);
  console.info(`Candidate Score:   ${metadata.candidateScore.toPrecision(8)}`);
  console.info(
    `Score Delta:       ${metadata.scoreDelta.toPrecision(8)} (${
      metadata.scoreDelta > 0 ? "IMPROVED" : "DEGRADED"
    })`,
  );
  console.info("");

  // Log prediction details
  if (cacheEntry.predictionDetails) {
    console.info("--- Rust Prediction Details ---");
    console.info(JSON.stringify(cacheEntry.predictionDetails, null, 2));
    console.info("");
  }

  // Log error comparison
  if (cacheEntry.errorComparison) {
    console.info("--- Error Comparison ---");
    const ec = cacheEntry.errorComparison as ErrorComparison;
    console.info(`Original MSE:          ${ec.originalMSE.toExponential(6)}`);
    console.info(`Candidate MSE:         ${ec.candidateMSE.toExponential(6)}`);
    console.info(
      `Actual Error Delta:    ${ec.actualErrorReduction.toExponential(6)} (${
        ec.actualErrorReductionPct.toFixed(4)
      }%)`,
    );
    if (ec.expectedErrorReductionPct !== undefined) {
      console.info(
        `Expected Error Delta:  ${
          (ec.expectedErrorReduction ?? 0).toExponential(6)
        } (${ec.expectedErrorReductionPct.toFixed(4)}%)`,
      );
      console.info(
        `Prediction Direction:  ${
          ec.predictionDirectionCorrect ? "✓ CORRECT" : "✗ INVERTED"
        }`,
      );
    }
    console.info("");
  }

  // Log target neuron info
  if (cacheEntry.targetNeuronInfo) {
    console.info("--- Target Neuron Info ---");
    console.info(JSON.stringify(cacheEntry.targetNeuronInfo, null, 2));
    console.info("");
  }

  // Log actual changes
  if (cacheEntry.actualCreatureChange) {
    console.info("--- Actual Creature Changes ---");
    console.info(JSON.stringify(cacheEntry.actualCreatureChange, null, 2));
    console.info("");
  }

  console.info("=".repeat(80));
}

/**
 * Checks if a discovery candidate is already cached as a failure.
 *
 * @param cacheDir - The cache directory path
 * @param candidate - The candidate to check
 * @returns true if the candidate was previously cached as a failure
 */
export async function isCandidateCached(
  cacheDir: string,
  candidate: DiscoveryCandidate,
): Promise<boolean> {
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const stat = await Deno.stat(filePath);
    return stat.isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    // Log unexpected errors but don't fail
    console.warn(
      `[FailureCache] Error checking cache for candidate: ${error}`,
    );
    return false;
  }
}

/**
 * Synchronously checks if a discovery candidate is already cached as a failure.
 *
 * @param cacheDir - The cache directory path
 * @param candidate - The candidate to check
 * @returns true if the candidate was previously cached as a failure
 */
export function isCandidateCachedSync(
  cacheDir: string,
  candidate: DiscoveryCandidate,
): boolean {
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const stat = Deno.statSync(filePath);
    return stat.isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    // Log unexpected errors but don't fail
    console.warn(
      `[FailureCache] Error checking cache for candidate: ${error}`,
    );
    return false;
  }
}

/**
 * Records a discovery candidate as a failure in the cache.
 *
 * Enhanced with diagnostic fields to help debug prediction inversions:
 * - predictionDetails: Rust prediction parameters
 * - errorComparison: Expected vs actual error with direction analysis
 * - targetNeuronInfo: Information about the target neuron
 *
 * @param cacheDir - The cache directory path
 * @param candidate - The candidate that failed to improve
 * @param metadata - Additional metadata about the failure
 * @param baseCreature - Optional base creature to compare against for extracting actual changes
 */
export async function recordFailure(
  cacheDir: string,
  candidate: DiscoveryCandidate,
  metadata: FailureMetadata,
  baseCreature?: Creature,
): Promise<void> {
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const dir = dirname(filePath);

    // Ensure directory exists
    await Deno.mkdir(dir, { recursive: true });

    // Write cache entry with metadata and candidate details
    const cacheEntry: Record<string, unknown> = {
      key: buildCacheKey(candidate),
      changeType: candidate.change.type,
      description: candidate.change.description,
      ...metadata,
      timestamp: new Date().toISOString(),
    };

    // Include neuronDetails if available (for add-neurons candidates)
    // This is what Rust requested
    if (candidate.change.neuronDetails) {
      cacheEntry.rustRequest = {
        neuronDetails: candidate.change.neuronDetails,
      };
    }

    // Include synapseDetails if available (for remove-synapse candidates)
    if (candidate.change.synapseDetails) {
      cacheEntry.synapseDetails = candidate.change.synapseDetails;
    }

    // Include expected error reduction if available
    if (candidate.change.expectedErrorReduction !== undefined) {
      cacheEntry.expectedErrorReduction =
        candidate.change.expectedErrorReduction;
    }

    // Include sample size if available
    if (candidate.change.sampleSize !== undefined) {
      cacheEntry.sampleSize = candidate.change.sampleSize;
    }

    // Compute and include actual error reduction if both errors are finite
    // actualErrorReduction = originalError - candidateError (positive means improvement)
    // Skip if either error is non-finite (NaN, Infinity) as this indicates evaluation issues
    if (
      metadata.originalError !== undefined &&
      Number.isFinite(metadata.originalError) &&
      Number.isFinite(metadata.error)
    ) {
      const actualErrorReduction = metadata.originalError - metadata.error;
      cacheEntry.actualErrorReduction = actualErrorReduction;
    }

    // Extract and include actual creature changes for verification
    // This is what TypeScript actually created (after fix() etc.)
    if (baseCreature) {
      const actualChanges = extractActualCreatureChanges(
        baseCreature,
        candidate.creature,
      );
      if (actualChanges) {
        cacheEntry.actualCreatureChange = actualChanges;
      }

      // Enhanced diagnostics for debugging prediction inversions

      // Extract prediction details from the candidate
      const predictionDetails = extractPredictionDetails(candidate);
      if (predictionDetails) {
        cacheEntry.predictionDetails = predictionDetails;
      }

      // Build error comparison details
      const errorComparison = buildErrorComparison(
        metadata,
        candidate.change.expectedErrorReduction,
      );
      if (errorComparison) {
        cacheEntry.errorComparison = errorComparison;
      }

      // Extract target neuron info
      const targetNeuronInfo = extractTargetNeuronInfo(
        candidate,
        baseCreature,
      );
      if (targetNeuronInfo) {
        cacheEntry.targetNeuronInfo = targetNeuronInfo;
      }
    }

    // Log prediction trace if enabled
    logPredictionTrace(candidate, metadata, cacheEntry);

    await Deno.writeTextFile(filePath, JSON.stringify(cacheEntry, null, 2));
  } catch (error) {
    // Log but don't fail - caching is an optimisation, not critical
    console.warn(
      `[FailureCache] Failed to record failure for candidate ${candidate.change.type}: ${error}`,
    );
  }
}

/**
 * Synchronously records a discovery candidate as a failure in the cache.
 *
 * Enhanced with diagnostic fields to help debug prediction inversions:
 * - predictionDetails: Rust prediction parameters
 * - errorComparison: Expected vs actual error with direction analysis
 * - targetNeuronInfo: Information about the target neuron
 *
 * @param cacheDir - The cache directory path
 * @param candidate - The candidate that failed to improve
 * @param metadata - Additional metadata about the failure
 * @param baseCreature - Optional base creature to compare against for extracting actual changes
 */
export function recordFailureSync(
  cacheDir: string,
  candidate: DiscoveryCandidate,
  metadata: FailureMetadata,
  baseCreature?: Creature,
): void {
  try {
    const filePath = getCacheFilePath(cacheDir, candidate);
    const dir = dirname(filePath);

    // Ensure directory exists
    Deno.mkdirSync(dir, { recursive: true });

    // Write cache entry with metadata and candidate details
    const cacheEntry: Record<string, unknown> = {
      key: buildCacheKey(candidate),
      changeType: candidate.change.type,
      description: candidate.change.description,
      ...metadata,
      timestamp: new Date().toISOString(),
    };

    // Include neuronDetails if available (for add-neurons candidates)
    // This is what Rust requested
    if (candidate.change.neuronDetails) {
      cacheEntry.rustRequest = {
        neuronDetails: candidate.change.neuronDetails,
      };
    }

    // Include synapseDetails if available (for remove-synapse candidates)
    if (candidate.change.synapseDetails) {
      cacheEntry.synapseDetails = candidate.change.synapseDetails;
    }

    // Include expected error reduction if available
    if (candidate.change.expectedErrorReduction !== undefined) {
      cacheEntry.expectedErrorReduction =
        candidate.change.expectedErrorReduction;
    }

    // Include sample size if available
    if (candidate.change.sampleSize !== undefined) {
      cacheEntry.sampleSize = candidate.change.sampleSize;
    }

    // Compute and include actual error reduction if both errors are finite
    // actualErrorReduction = originalError - candidateError (positive means improvement)
    // Skip if either error is non-finite (NaN, Infinity) as this indicates evaluation issues
    if (
      metadata.originalError !== undefined &&
      Number.isFinite(metadata.originalError) &&
      Number.isFinite(metadata.error)
    ) {
      const actualErrorReduction = metadata.originalError - metadata.error;
      cacheEntry.actualErrorReduction = actualErrorReduction;
    }

    // Extract and include actual creature changes for verification
    // This is what TypeScript actually created (after fix() etc.)
    if (baseCreature) {
      const actualChanges = extractActualCreatureChanges(
        baseCreature,
        candidate.creature,
      );
      if (actualChanges) {
        cacheEntry.actualCreatureChange = actualChanges;
      }

      // Enhanced diagnostics for debugging prediction inversions

      // Extract prediction details from the candidate
      const predictionDetails = extractPredictionDetails(candidate);
      if (predictionDetails) {
        cacheEntry.predictionDetails = predictionDetails;
      }

      // Build error comparison details
      const errorComparison = buildErrorComparison(
        metadata,
        candidate.change.expectedErrorReduction,
      );
      if (errorComparison) {
        cacheEntry.errorComparison = errorComparison;
      }

      // Extract target neuron info
      const targetNeuronInfo = extractTargetNeuronInfo(
        candidate,
        baseCreature,
      );
      if (targetNeuronInfo) {
        cacheEntry.targetNeuronInfo = targetNeuronInfo;
      }
    }

    // Log prediction trace if enabled
    logPredictionTrace(candidate, metadata, cacheEntry);

    Deno.writeTextFileSync(filePath, JSON.stringify(cacheEntry, null, 2));
  } catch (error) {
    // Log but don't fail - caching is an optimisation, not critical
    console.warn(
      `[FailureCache] Failed to record failure for candidate ${candidate.change.type}: ${error}`,
    );
  }
}

/**
 * Filters candidates, removing those that are already cached as failures.
 *
 * @param cacheDir - The cache directory path (if undefined, no filtering is done)
 * @param candidates - The candidates to filter
 * @returns Object with filtered candidates and count of skipped candidates
 */
export function filterCachedCandidates(
  cacheDir: string | undefined,
  candidates: DiscoveryCandidate[],
): { filtered: DiscoveryCandidate[]; cachedCount: number } {
  if (!cacheDir) {
    return { filtered: candidates, cachedCount: 0 };
  }

  const filtered: DiscoveryCandidate[] = [];
  let cachedCount = 0;

  for (const candidate of candidates) {
    if (isCandidateCachedSync(cacheDir, candidate)) {
      cachedCount++;
    } else {
      filtered.push(candidate);
    }
  }

  return { filtered, cachedCount };
}

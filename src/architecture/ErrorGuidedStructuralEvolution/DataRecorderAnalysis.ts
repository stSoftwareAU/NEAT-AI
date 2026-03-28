/**
 * Analysis phase logic for the DataRecorder.
 *
 * Extracts the analysis retry loop from the DataRecorder's recordFiles method
 * to keep individual modules under ~500 lines.
 */

import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { NeatConfig } from "../../config/NeatConfig.ts";
import type { DiscoverResult } from "./DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "./DiscoverStructure.ts";
import type { DiscoverStructure } from "./DiscoverStructure.ts";
import type { DiscoveryPerformanceStats } from "./DiscoveryPerformance.ts";
import { shouldLogDiscovery } from "./DiscoveryPerformance.ts";
import type { PhaseDiagnostics } from "./PhaseDiagnostics.ts";
import { getLogger } from "../../utils/Logger.ts";

/**
 * Context required by the analysis loop, provided by the DataRecorder.
 */
export interface AnalysisLoopContext {
  readonly ID: string;
  readonly config: NeatConfig;
  readonly discoveryMaxNeurons: number;
  readonly costOfGrowth: number;
  /** Current analysis deadline timestamp in ms. */
  getTimeoutTS(): number;
  /** Refresh the analysis timeout on the DiscoverStructure instance. */
  refreshAnalysisTimeout(discoverStructure: DiscoverStructure): void;
}

function classifyCandidateTag(
  _gain: number,
  comment?: string,
): "CANDIDATE" | "FALLBACK" | "SPLIT-ERROR" {
  const normalised = typeof comment === "string"
    ? comment.trim().toLowerCase()
    : "";
  if (normalised.includes("split-error")) return "SPLIT-ERROR";
  if (normalised.includes("fallback")) return "FALLBACK";
  return "CANDIDATE";
}

function formatGainPct(gain: number): string {
  const pct = gain * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(4)}%`;
}

function logCandidate(
  discoveryID: string,
  scope: "SYNAPSE" | "NEURON" | "HARMFUL-SYNAPSE" | "HARMFUL-NEURON",
  from: string | number,
  to: string | number,
  gain: number,
  improved: number,
  total: number,
  comment?: string,
): void {
  const tag = classifyCandidateTag(gain, comment);
  const commentText = comment ? ` comment=${JSON.stringify(comment)}` : "";
  getLogger().info(
    `Discovery ${blue(discoveryID)} ${scope} ${tag} ${from} -> ${to} expected=${
      formatGainPct(gain)
    } improved=${improved}/${total}${commentText}`,
  );
}

function countFallbackCandidates<
  T extends { expectedCreatureScoreGain: number; comment?: string },
>(
  candidates: T[] | undefined,
): number {
  return (candidates ?? []).filter((c) =>
    classifyCandidateTag(c.expectedCreatureScoreGain, c.comment) ===
      "FALLBACK"
  ).length;
}

/**
 * Logs candidate details for helpful synapses, neurons, and harmful entries.
 */
function logAllCandidates(
  discoveryID: string,
  addHelpfulSynapse: CandidateSynapse[] | undefined,
  addHelpfulNeurons: CandidateNeuron[] | undefined,
  removeHarmfulSynapse: CandidateSynapse | undefined,
  removeHarmfulNeurons: CandidateHarmfulNeuron[] | undefined,
): void {
  for (const candidate of addHelpfulSynapse ?? []) {
    logCandidate(
      discoveryID,
      "SYNAPSE",
      candidate.fromNeuronUuid,
      candidate.toNeuronUuid,
      candidate.expectedCreatureScoreGain,
      candidate.improvedCount,
      candidate.totalCount,
      candidate.comment,
    );
  }
  for (const candidate of addHelpfulNeurons ?? []) {
    logCandidate(
      discoveryID,
      "NEURON",
      candidate.fromNeuronUuid,
      candidate.toNeuronUuid,
      candidate.expectedCreatureScoreGain,
      candidate.improvedCount,
      candidate.totalCount,
      candidate.comment,
    );
  }
  if (removeHarmfulSynapse) {
    logCandidate(
      discoveryID,
      "HARMFUL-SYNAPSE",
      removeHarmfulSynapse.fromNeuronUuid,
      removeHarmfulSynapse.toNeuronUuid,
      removeHarmfulSynapse.expectedCreatureScoreGain,
      removeHarmfulSynapse.improvedCount,
      removeHarmfulSynapse.totalCount,
      removeHarmfulSynapse.comment,
    );
  }
  for (const candidate of removeHarmfulNeurons ?? []) {
    logCandidate(
      discoveryID,
      "HARMFUL-NEURON",
      candidate.neuronUuid,
      candidate.neuronUuid,
      candidate.expectedCreatureScoreGain,
      candidate.sampleCount,
      candidate.sampleCount,
      candidate.comment,
    );
  }
}

/**
 * Runs the analysis retry loop, selecting focus neurons and analysing them
 * for candidate mutations until time expires or no new neurons remain.
 *
 * Modifies `perfStats` in place and returns the accumulated DiscoverResult fields.
 */
export async function runAnalysisLoop(
  ctx: AnalysisLoopContext,
  discoverStructure: DiscoverStructure,
  perfStats: DiscoveryPerformanceStats,
  phaseDiagnostics: PhaseDiagnostics,
): Promise<DiscoverResult> {
  const { config, ID } = ctx;

  const discoverResult: DiscoverResult = {
    ID,
    addHelpfulSynapses: undefined,
    addHelpfulNeurons: undefined,
    coordinatedStructuralCandidates: undefined,
    removeHarmfulSynapse: undefined,
    removeHarmfulNeurons: undefined,
    removalCandidates: undefined,
    candidateSquashes: undefined,
  };

  // Track attempted neurons to avoid re-analyzing the same ones
  const attemptedNeurons = new Set<number>();
  let retryAttempt = 0;
  const maxRetries = 10; // Reasonable limit to prevent infinite loops

  // Retry loop: try different neurons if no candidates found and time remains
  // Sequential execution is intentional - we check results after each attempt
  const analysisPhaseStartTime = Date.now();
  while (retryAttempt <= maxRetries) {
    // Allow callers (especially tests) to explicitly skip the analysis phase by
    // setting discoveryMaxNeurons to 0. This keeps record/flush coverage (FFI)
    // while avoiding long-running Rust analysis on GPU-backed machines.
    if (ctx.discoveryMaxNeurons <= 0) {
      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${
            blue(ID)
          } skipping analysis phase because discoveryMaxNeurons <= 0`,
        );
      }
      break;
    }
    const focusSelectStart = Date.now();
    // deno-lint-ignore no-await-in-loop
    const focusList = await discoverStructure.selectNeuronsWeightedByError(
      ctx.discoveryMaxNeurons,
      ctx.costOfGrowth,
      retryAttempt > 0 ? retryAttempt : undefined,
    );
    perfStats.focusSelectionTime += Date.now() - focusSelectStart;

    // Filter out neurons we've already tried
    const newFocusList = focusList.filter((uuid) =>
      !attemptedNeurons.has(uuid)
    );

    if (shouldLogDiscovery(config)) {
      const selectTime = Date.now() - focusSelectStart;
      const retryMsg = retryAttempt > 0
        ? ` (retry ${retryAttempt}, ${attemptedNeurons.size} already tried)`
        : "";
      getLogger().info(
        `Discovery ${blue(ID)} selected ${
          yellow(newFocusList.length.toString())
        } focus neuron${newFocusList.length === 1 ? "" : "s"} in ${
          yellow(format(selectTime, { ignoreZero: true }))
        }${retryMsg}`,
      );
    }

    // Mark these neurons as attempted
    newFocusList.forEach((uuid) => attemptedNeurons.add(uuid));
    perfStats.neuronsAnalyzed += newFocusList.length;

    // If we have no new neurons to try, stop retrying
    if (newFocusList.length === 0) {
      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${
            blue(ID)
          } no new neurons to analyze, stopping retry loop`,
        );
      }
      break;
    }

    const rustAnalysisStart = Date.now();
    const combinedResult = discoverStructure.ensureRustCombinedAnalysis(
      newFocusList,
      true, // includeSynapse
      true, // includeNeuron
    );
    const rustAnalysisTime = Date.now() - rustAnalysisStart;
    perfStats.rustCombinedAnalysisTime += rustAnalysisTime;
    if (combinedResult) {
      ctx.refreshAnalysisTimeout(discoverStructure);
    }

    phaseDiagnostics.enterPhase("analysis_parallel");
    let addHelpfulNeurons: CandidateNeuron[] | undefined;
    let coordinatedStructuralCandidates:
      | import("./CoordinatedStructuralCandidate.ts").CoordinatedStructuralCandidate[]
      | undefined;
    let addHelpfulSynapse: CandidateSynapse[] | undefined;
    let removeHarmfulSynapse: CandidateSynapse | undefined;
    let removeHarmfulNeurons: CandidateHarmfulNeuron[] | undefined;
    let candidateSquashes: CandidateSquash[] | undefined;

    const parallelStartTime = Date.now();
    const candidateBundle = discoverStructure.collectRustAnalysisCandidates(
      newFocusList,
    );
    const candidateCollectionTime = Date.now() - parallelStartTime;

    if (candidateBundle) {
      phaseDiagnostics.enterPhase("analysis_loop");
      addHelpfulSynapse = candidateBundle.helpfulSynapses;
      removeHarmfulSynapse = candidateBundle.harmfulSynapse;
      addHelpfulNeurons = candidateBundle.helpfulNeurons;
      coordinatedStructuralCandidates =
        candidateBundle.coordinatedStructuralCandidates;
      ctx.refreshAnalysisTimeout(discoverStructure);

      if (shouldLogDiscovery(config)) {
        const helpfulSynapseCount = addHelpfulSynapse?.length ?? 0;
        const helpfulNeuronCount = addHelpfulNeurons?.length ?? 0;
        const coordinatedCount = coordinatedStructuralCandidates?.length ?? 0;
        const harmfulSynapseCount = removeHarmfulSynapse ? 1 : 0;
        const fallbackSynapses = countFallbackCandidates(addHelpfulSynapse);
        const fallbackNeurons = countFallbackCandidates(addHelpfulNeurons);

        const synapseMeta = candidateBundle.synapseMetadata;
        const neuronMeta = candidateBundle.neuronMetadata;
        const synapseMetaText = synapseMeta
          ? `, synapse meta: found=${synapseMeta.candidatesFound} returned=${synapseMeta.candidatesReturned}`
          : "";
        const neuronMetaText = neuronMeta
          ? `, neuron meta: found=${neuronMeta.candidatesFound} returned=${neuronMeta.candidatesReturned}`
          : "";

        getLogger().info(
          `Discovery ${blue(ID)} candidate collection ${
            yellow(format(candidateCollectionTime, {
              ignoreZero: true,
            }))
          } helpful synapses: ${helpfulSynapseCount} (fallback ${fallbackSynapses}), helpful neurons: ${helpfulNeuronCount} (fallback ${fallbackNeurons}), coordinated-structural: ${coordinatedCount}, harmful synapse removals: ${harmfulSynapseCount}${synapseMetaText}${neuronMetaText}`,
        );

        logAllCandidates(
          ID,
          addHelpfulSynapse,
          addHelpfulNeurons,
          removeHarmfulSynapse,
          undefined,
        );
      }

      const squashStartTime = Date.now();
      // deno-lint-ignore no-await-in-loop
      candidateSquashes = await discoverStructure
        .analyzeSelectedNeuronsSquashes(newFocusList);
      ctx.refreshAnalysisTimeout(discoverStructure);
      const squashTime = Date.now() - squashStartTime;
      perfStats.squashAnalysisTime += squashTime;
      if (shouldLogDiscovery(config)) {
        logSquashResults(ID, squashTime, candidateSquashes);
      }
    } else {
      // deno-lint-ignore no-await-in-loop
      const analysisResults = await runParallelAnalysis(
        ctx,
        discoverStructure,
        perfStats,
        phaseDiagnostics,
        newFocusList,
      );
      phaseDiagnostics.enterPhase("analysis_loop");
      [
        addHelpfulNeurons,
        addHelpfulSynapse,
        removeHarmfulSynapse,
        candidateSquashes,
        removeHarmfulNeurons,
      ] = analysisResults;

      if (shouldLogDiscovery(config)) {
        logAllCandidates(
          ID,
          addHelpfulSynapse,
          addHelpfulNeurons,
          removeHarmfulSynapse,
          removeHarmfulNeurons,
        );
      }
    }

    accumulateResults(
      discoverResult,
      addHelpfulNeurons,
      coordinatedStructuralCandidates,
      addHelpfulSynapse,
      removeHarmfulSynapse,
      candidateSquashes,
      removeHarmfulNeurons,
    );

    // Check if we found any candidates
    const foundCandidates = Boolean(
      discoverResult.addHelpfulSynapses ||
        discoverResult.addHelpfulNeurons ||
        discoverResult.coordinatedStructuralCandidates ||
        discoverResult.removeHarmfulSynapse ||
        discoverResult.removeHarmfulNeurons ||
        discoverResult.candidateSquashes,
    );
    if (foundCandidates && shouldLogDiscovery(config)) {
      getLogger().info(
        `Discovery ${
          blue(ID)
        } accumulated candidate updates; continuing search while time remains.`,
      );
    }

    const timeRemaining = ctx.getTimeoutTS() - Date.now();
    if (timeRemaining <= 0) {
      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${
            blue(ID)
          } analysis timeout reached after evaluating ${attemptedNeurons.size} neuron(s)`,
        );
      }
      break;
    }

    perfStats.retryAttempts = retryAttempt;
    retryAttempt++;
    if (shouldLogDiscovery(config)) {
      getLogger().info(
        `Discovery ${blue(ID)} retrying with different neurons (${
          yellow(format(timeRemaining, { ignoreZero: true }))
        } remaining, retry ${retryAttempt})`,
      );
    }
  }
  perfStats.analysisPhaseTime = Date.now() - analysisPhaseStartTime;

  // Collect low-impact removal candidates from Rust focus ranking
  const removalCandidates = discoverStructure.getRemovalCandidates();
  if (removalCandidates && removalCandidates.length > 0) {
    discoverResult.removalCandidates = removalCandidates;
    if (shouldLogDiscovery(config)) {
      getLogger().info(
        `Discovery ${blue(ID)} found ${
          yellow(removalCandidates.length.toString())
        } low-impact removal candidate${
          removalCandidates.length === 1 ? "" : "s"
        }`,
      );
    }
  }

  return discoverResult;
}

function logSquashResults(
  discoveryID: string,
  squashTime: number,
  candidateSquashes: CandidateSquash[] | undefined,
): void {
  const squashCount = candidateSquashes?.length ?? 0;
  let squashSummaryText = "";
  if (squashCount > 0 && candidateSquashes) {
    const squashSummary = candidateSquashes.map((candidate) => {
      return `${candidate.neuronUuid} ${candidate.previousSquash} -> ${candidate.squash} expected: ${
        (candidate.expectedCreatureScoreGain * 100).toFixed(1)
      }% error: ${candidate.currentError.toFixed(4)} -> ${
        candidate.improvedError.toFixed(4)
      }`;
    });
    squashSummaryText = `, Summary: ${squashSummary.join(",")}`;
  }
  getLogger().info(
    `Discovery ${blue(discoveryID)} analyze squashes time ${
      yellow(format(squashTime, { ignoreZero: true }))
    } found ${squashCount} candidate${
      squashCount === 1 ? "" : "s"
    }${squashSummaryText}`,
  );
}

async function runParallelAnalysis(
  ctx: AnalysisLoopContext,
  discoverStructure: DiscoverStructure,
  perfStats: DiscoveryPerformanceStats,
  phaseDiagnostics: PhaseDiagnostics,
  newFocusList: number[],
): Promise<[
  CandidateNeuron[] | undefined,
  CandidateSynapse[] | undefined,
  CandidateSynapse | undefined,
  CandidateSquash[] | undefined,
  CandidateHarmfulNeuron[] | undefined,
]> {
  const { config, ID } = ctx;

  const runAnalysisPhase = <T>(
    label: string,
    executor: () => Promise<T>,
  ): Promise<T> => {
    const stopTracking = phaseDiagnostics.startParallelPhase(label);
    return executor()
      .finally(() => {
        stopTracking();
      });
  };

  const neuronPromise = runAnalysisPhase(
    "analyze_neurons",
    async () => {
      const neuronAnalyzeStart = Date.now();
      const helpfulNeurons = await discoverStructure
        .analyzeMissingNeurons(newFocusList);
      ctx.refreshAnalysisTimeout(discoverStructure);
      const neuronAnalyzeTime = Date.now() - neuronAnalyzeStart;
      perfStats.neuronAnalysisTime += neuronAnalyzeTime;
      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${blue(ID)} analyze neurons time ${
            yellow(format(neuronAnalyzeTime, { ignoreZero: true }))
          } found ${
            helpfulNeurons ? helpfulNeurons.length : 0
          } neuron candidates`,
        );
      }
      return helpfulNeurons;
    },
  );

  const synapsePromise = runAnalysisPhase(
    "analyze_helpful",
    async () => {
      const analyzeStartTime = Date.now();
      const helpfulSynapses = await discoverStructure
        .analyzeSelectedNeurons(newFocusList);
      ctx.refreshAnalysisTimeout(discoverStructure);
      const analyzeTime = Date.now() - analyzeStartTime;
      perfStats.synapseAnalysisTime += analyzeTime;
      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${blue(ID)} analyze synapses time ${
            yellow(format(analyzeTime, { ignoreZero: true }))
          } found ${helpfulSynapses ? helpfulSynapses.length : 0} candidate${
            helpfulSynapses && helpfulSynapses.length === 1 ? "" : "s"
          }`,
        );
      }
      return helpfulSynapses;
    },
  );

  const harmfulPromise = runAnalysisPhase(
    "analyze_harmful",
    async () => {
      const harmfulStartTime = Date.now();
      const harmfulSynapse = await discoverStructure
        .analyzeSelectedNeuronsForRemoval(newFocusList);
      ctx.refreshAnalysisTimeout(discoverStructure);
      const harmfulTime = Date.now() - harmfulStartTime;
      perfStats.harmfulSynapseAnalysisTime += harmfulTime;
      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${blue(ID)} analyze harmful time ${
            yellow(format(harmfulTime, { ignoreZero: true }))
          } found ${harmfulSynapse ? 1 : 0} candidates`,
        );
      }
      return harmfulSynapse;
    },
  );

  const squashPromise = runAnalysisPhase(
    "analyze_squash",
    async () => {
      const squashStartTime = Date.now();
      const squashes = await discoverStructure
        .analyzeSelectedNeuronsSquashes(newFocusList);
      ctx.refreshAnalysisTimeout(discoverStructure);
      const squashTime = Date.now() - squashStartTime;
      perfStats.squashAnalysisTime += squashTime;
      if (shouldLogDiscovery(config)) {
        logSquashResults(ID, squashTime, squashes);
      }
      return squashes;
    },
  );

  const harmfulNeuronPromise = runAnalysisPhase(
    "analyze_harmful_neurons",
    async () => {
      const harmfulNeuronStartTime = Date.now();
      const harmfulNeurons = await discoverStructure
        .analyzeSelectedNeuronsForHarmfulRemoval(newFocusList);
      ctx.refreshAnalysisTimeout(discoverStructure);
      const harmfulNeuronTime = Date.now() - harmfulNeuronStartTime;
      perfStats.harmfulNeuronAnalysisTime += harmfulNeuronTime;
      if (shouldLogDiscovery(config)) {
        const harmfulNeuronCount = harmfulNeurons ? harmfulNeurons.length : 0;
        getLogger().info(
          `Discovery ${blue(ID)} analyze harmful neurons time ${
            yellow(format(harmfulNeuronTime, { ignoreZero: true }))
          } found ${harmfulNeuronCount} candidate${
            harmfulNeuronCount === 1 ? "" : "s"
          }`,
        );
      }
      return harmfulNeurons;
    },
  );

  const analysisPromises: [
    Promise<CandidateNeuron[] | undefined>,
    Promise<CandidateSynapse[] | undefined>,
    Promise<CandidateSynapse | undefined>,
    Promise<CandidateSquash[] | undefined>,
    Promise<CandidateHarmfulNeuron[] | undefined>,
  ] = [
    neuronPromise,
    synapsePromise,
    harmfulPromise,
    squashPromise,
    harmfulNeuronPromise,
  ];
  return await Promise.all(analysisPromises);
}

function accumulateResults(
  discoverResult: DiscoverResult,
  addHelpfulNeurons: CandidateNeuron[] | undefined,
  coordinatedStructuralCandidates:
    | import("./CoordinatedStructuralCandidate.ts").CoordinatedStructuralCandidate[]
    | undefined,
  addHelpfulSynapse: CandidateSynapse[] | undefined,
  removeHarmfulSynapse: CandidateSynapse | undefined,
  candidateSquashes: CandidateSquash[] | undefined,
  removeHarmfulNeurons: CandidateHarmfulNeuron[] | undefined,
): void {
  if (addHelpfulNeurons && addHelpfulNeurons.length > 0) {
    discoverResult.addHelpfulNeurons = [
      ...(discoverResult.addHelpfulNeurons ?? []),
      ...addHelpfulNeurons,
    ];
  }
  if (
    coordinatedStructuralCandidates &&
    coordinatedStructuralCandidates.length > 0
  ) {
    discoverResult.coordinatedStructuralCandidates = [
      ...(discoverResult.coordinatedStructuralCandidates ?? []),
      ...coordinatedStructuralCandidates,
    ];
  }
  if (addHelpfulSynapse && addHelpfulSynapse.length > 0) {
    discoverResult.addHelpfulSynapses = [
      ...(discoverResult.addHelpfulSynapses ?? []),
      ...addHelpfulSynapse,
    ];
  }
  if (removeHarmfulSynapse && !discoverResult.removeHarmfulSynapse) {
    discoverResult.removeHarmfulSynapse = removeHarmfulSynapse;
  }
  if (candidateSquashes && candidateSquashes.length > 0) {
    discoverResult.candidateSquashes = [
      ...(discoverResult.candidateSquashes ?? []),
      ...candidateSquashes,
    ];
  }
  if (removeHarmfulNeurons && removeHarmfulNeurons.length > 0) {
    discoverResult.removeHarmfulNeurons = [
      ...(discoverResult.removeHarmfulNeurons ?? []),
      ...removeHarmfulNeurons,
    ];
  }
}

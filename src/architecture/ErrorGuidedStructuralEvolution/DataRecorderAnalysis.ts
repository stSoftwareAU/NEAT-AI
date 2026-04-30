/**
 * Analysis phase logic for the DataRecorder.
 *
 * Extracts the analysis retry loop from the DataRecorder's recordFiles method
 * to keep individual modules under ~500 lines.
 */

import { blue, yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import type { NeatConfig } from "@config/NeatConfig.ts";
import type { DiscoverResult } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { DiscoveryPerformanceStats } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import { shouldLogDiscovery } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import type { PhaseDiagnostics } from "@architecture/ErrorGuidedStructuralEvolution/PhaseDiagnostics.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Signature for the parallel analysis driver. Exposed so tests can inject a
 * stubbed implementation that never resolves (Issue #2420).
 */
export type ParallelAnalysisFn = (
  ctx: AnalysisLoopContext,
  discoverStructure: DiscoverStructure,
  perfStats: DiscoveryPerformanceStats,
  phaseDiagnostics: PhaseDiagnostics,
  newFocusList: number[],
) => Promise<[
  CandidateNeuron[] | undefined,
  CandidateSynapse[] | undefined,
  CandidateSynapse | undefined,
  CandidateSquash[] | undefined,
  CandidateHarmfulNeuron[] | undefined,
]>;

/**
 * Default grace in milliseconds added to `perChunkMaxMs` before the
 * mid-flight timeout fires (Issue #2420). A small amount of slack avoids
 * racing the budget in normal operation.
 */
export const DEFAULT_PER_CHUNK_GRACE_MS = 1_000;

/**
 * Context required by the analysis loop, provided by the DataRecorder.
 */
export interface AnalysisLoopContext {
  readonly ID: string;
  readonly config: NeatConfig;
  readonly discoveryMaxNeurons: number;
  readonly costOfGrowth: number;
  /**
   * Maximum number of neurons submitted to one Rust combined-analysis FFI
   * call. The analysis loop splits the focus list into chunks of at most this
   * size. Values <= 0 or >= focus list length submit the whole list at once
   * (Issue #2380).
   */
  readonly analysisChunkSize: number;
  /**
   * Maximum milliseconds a single Rust combined-analysis chunk may take
   * before the analysis loop stops submitting further chunks and skips the
   * remaining retry iterations for this discovery cycle (Issue #2380). Set
   * to 0 to disable the stall guard.
   */
  readonly perChunkMaxMs: number;
  /**
   * Optional grace added to `perChunkMaxMs` when constructing the mid-flight
   * timeout race against `runParallelAnalysis` (Issue #2420). Defaults to
   * {@link DEFAULT_PER_CHUNK_GRACE_MS}.
   */
  readonly perChunkGraceMs?: number;
  /** Current analysis deadline timestamp in ms. */
  getTimeoutTS(): number;
  /** Refresh the analysis timeout on the DiscoverStructure instance. */
  refreshAnalysisTimeout(discoverStructure: DiscoverStructure): void;
  /**
   * Optional clock injection for deterministic tests (Issue #2380). Defaults
   * to Date.now. Production code should not set this.
   */
  readonly now?: () => number;
  /**
   * Optional override for the parallel analysis driver (Issue #2420). Tests
   * can inject a stubbed implementation (e.g. one that never resolves) to
   * exercise the mid-flight timeout path. Production code should not set
   * this.
   */
  readonly runParallelAnalysis?: ParallelAnalysisFn;
}

/**
 * Split a focus list into chunks of at most `chunkSize` neurons.
 *
 * `chunkSize <= 0` returns a single chunk containing the whole list
 * (chunking disabled). This is exported for tests (Issue #2380).
 */
export function chunkFocusList(
  focusList: readonly number[],
  chunkSize: number,
): number[][] {
  if (focusList.length === 0) return [];
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    return [Array.from(focusList)];
  }
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: number[][] = [];
  for (let i = 0; i < focusList.length; i += size) {
    chunks.push(Array.from(focusList.slice(i, i + size)));
  }
  return chunks;
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
  const now = ctx.now ?? Date.now;

  // Retry loop: try different neurons if no candidates found and time remains
  // Sequential execution is intentional - we check results after each attempt
  const analysisPhaseStartTime = now();
  let stalledFlag = false;
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
    const focusSelectStart = now();
    // deno-lint-ignore no-await-in-loop
    const focusList = await discoverStructure.selectNeuronsWeightedByError(
      ctx.discoveryMaxNeurons,
      ctx.costOfGrowth,
      retryAttempt > 0 ? retryAttempt : undefined,
    );
    perfStats.focusSelectionTime += now() - focusSelectStart;

    // Filter out neurons we've already tried
    const newFocusList = focusList.filter((uuid) =>
      !attemptedNeurons.has(uuid)
    );

    if (shouldLogDiscovery(config)) {
      const selectTime = now() - focusSelectStart;
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

    // Chunk the focus list so each Rust combined-analysis FFI call is
    // bounded in scope. This allows the loop to log per-chunk elapsed time,
    // detect stalls, and bail out before the full analysis budget is burned
    // on a single slow call (Issue #2380).
    const chunks = chunkFocusList(newFocusList, ctx.analysisChunkSize);
    // Defence-in-depth wall-clock cap for this analysis iteration: regardless
    // of individual chunk behaviour, never spend more than
    // `perChunkMaxMs * chunks.length` on chunk processing for one retry
    // iteration (Issue #2420). Prevents a single slow FFI call from burning
    // the entire discovery cycle before the per-chunk check fires.
    const iterationStart = now();
    const iterationCapMs = ctx.perChunkMaxMs > 0
      ? ctx.perChunkMaxMs * chunks.length
      : 0;
    let chunkIdx = 0;
    let iterationStalled = false;
    for (const chunk of chunks) {
      chunkIdx++;
      // Defence-in-depth: check cumulative wall-clock before submitting each
      // new chunk (Issue #2420). If earlier chunks have already burned the
      // overall budget, stop — the per-chunk check below would only fire
      // after yet another slow call returns.
      if (iterationCapMs > 0) {
        const iterationElapsed = now() - iterationStart;
        if (iterationElapsed >= iterationCapMs) {
          if (shouldLogDiscovery(config)) {
            getLogger().info(
              `Discovery ${
                blue(ID)
              } aborting remaining chunks before chunk ${chunkIdx}/${chunks.length}: iteration wall-clock ${
                yellow(format(iterationElapsed, { ignoreZero: true }))
              } exceeds cap ${
                yellow(format(iterationCapMs, { ignoreZero: true }))
              } (perChunkMaxMs * chunks)`,
            );
          }
          iterationStalled = true;
          break;
        }
      }
      const chunkStart = now();
      // Issue #2501: tighten the deadline forwarded to Rust per chunk so a
      // single synchronous FFI call cannot burn far more than its budget.
      // JS cannot interrupt the blocking FFI; the Rust-side deadline is the
      // only mechanism that actually bounds a chunk's wall-clock. We add a
      // small grace so well-behaved chunks finish without being clipped.
      const chunkGraceMs = Math.max(
        0,
        ctx.perChunkGraceMs ?? DEFAULT_PER_CHUNK_GRACE_MS,
      );
      const chunkDeadlineMs = ctx.perChunkMaxMs > 0
        ? chunkStart + ctx.perChunkMaxMs + chunkGraceMs
        : undefined;
      const combinedResult = discoverStructure.ensureRustCombinedAnalysis(
        chunk,
        true, // includeSynapse
        true, // includeNeuron
        chunkDeadlineMs,
      );
      const chunkElapsed = now() - chunkStart;
      perfStats.rustCombinedAnalysisTime += chunkElapsed;
      if (combinedResult) {
        ctx.refreshAnalysisTimeout(discoverStructure);
      }

      if (shouldLogDiscovery(config)) {
        const gpuInfo = describeGpuUsage(combinedResult);
        getLogger().info(
          `Discovery ${
            blue(ID)
          } rust combined analysis chunk ${chunkIdx}/${chunks.length} (${chunk.length} neuron${
            chunk.length === 1 ? "" : "s"
          }) in ${
            yellow(format(chunkElapsed, { ignoreZero: true }))
          }${gpuInfo}`,
        );
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

      const parallelStartTime = now();
      const candidateBundle = discoverStructure.collectRustAnalysisCandidates(
        chunk,
      );
      const candidateCollectionTime = now() - parallelStartTime;

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

        const squashStartTime = now();
        // Issue #2483: Drain harmful neurons that the squash analyser
        // detects above MAX_REASONABLE_SQUASH_ERROR — they used to be only
        // logged, leaving the bad neuron in place to break WASM
        // compilation downstream. Now they feed into removeHarmfulNeurons.
        const squashHarmfulSink: CandidateHarmfulNeuron[] = [];
        // deno-lint-ignore no-await-in-loop
        candidateSquashes = await discoverStructure
          .analyzeSelectedNeuronsSquashes(chunk, squashHarmfulSink);
        if (squashHarmfulSink.length > 0) {
          removeHarmfulNeurons = removeHarmfulNeurons
            ? [...removeHarmfulNeurons, ...squashHarmfulSink]
            : squashHarmfulSink;
        }
        ctx.refreshAnalysisTimeout(discoverStructure);
        const squashTime = now() - squashStartTime;
        perfStats.squashAnalysisTime += squashTime;
        if (shouldLogDiscovery(config)) {
          logSquashResults(ID, squashTime, candidateSquashes);
        }
      } else {
        const analysisFn: ParallelAnalysisFn = ctx.runParallelAnalysis ??
          runParallelAnalysis;
        // Race the parallel analysis against the per-chunk budget so a
        // hung driver cannot burn the whole analysis cycle. This gives up
        // on the in-flight Promise but does not interrupt any synchronous
        // Rust FFI already executing — the JS event loop is blocked until
        // the FFI returns. The race is a structural defence for async
        // drivers (and for tests) and ensures we stop submitting further
        // chunks even when the stall guard below can't observe the chunk
        // (Issue #2420).
        const graceMs = ctx.perChunkGraceMs ?? DEFAULT_PER_CHUNK_GRACE_MS;
        const budgetMs = ctx.perChunkMaxMs > 0
          ? ctx.perChunkMaxMs + Math.max(0, graceMs)
          : 0;
        type AnalysisTuple = [
          CandidateNeuron[] | undefined,
          CandidateSynapse[] | undefined,
          CandidateSynapse | undefined,
          CandidateSquash[] | undefined,
          CandidateHarmfulNeuron[] | undefined,
        ];
        type RaceResult =
          | { kind: "ok"; value: AnalysisTuple }
          | { kind: "timeout" };
        let analysisResults: AnalysisTuple | undefined;
        let timedOut = false;
        if (budgetMs > 0) {
          let timeoutHandle: number | undefined;
          const timeoutPromise = new Promise<RaceResult>((resolve) => {
            timeoutHandle = setTimeout(
              () => resolve({ kind: "timeout" }),
              budgetMs,
            );
          });
          const analysisPromise = analysisFn(
            ctx,
            discoverStructure,
            perfStats,
            phaseDiagnostics,
            chunk,
          ).then<RaceResult>((value) => ({ kind: "ok", value }));
          // Ensure unhandled rejection from a detached analysis promise is
          // swallowed after a timeout — we intentionally stop awaiting it.
          analysisPromise.catch(() => {});
          // deno-lint-ignore no-await-in-loop
          const raceResult = await Promise.race([
            analysisPromise,
            timeoutPromise,
          ]);
          if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle);
          }
          if (raceResult.kind === "timeout") {
            timedOut = true;
            if (shouldLogDiscovery(config)) {
              getLogger().info(
                `Discovery ${
                  blue(ID)
                } chunk ${chunkIdx}/${chunks.length} aborted mid-flight after ${
                  yellow(format(budgetMs, { ignoreZero: true }))
                } (Rust FFI exceeded per-chunk budget ${
                  yellow(format(ctx.perChunkMaxMs, { ignoreZero: true }))
                } + grace ${
                  yellow(format(Math.max(0, graceMs), { ignoreZero: true }))
                })`,
              );
            }
          } else {
            analysisResults = raceResult.value;
          }
        } else {
          // deno-lint-ignore no-await-in-loop
          analysisResults = await analysisFn(
            ctx,
            discoverStructure,
            perfStats,
            phaseDiagnostics,
            chunk,
          );
        }

        if (timedOut) {
          iterationStalled = true;
          break;
        }

        phaseDiagnostics.enterPhase("analysis_loop");
        [
          addHelpfulNeurons,
          addHelpfulSynapse,
          removeHarmfulSynapse,
          candidateSquashes,
          removeHarmfulNeurons,
        ] = analysisResults!;

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

      // Adaptive early-exit: if the Rust FFI chunk stalled beyond the
      // per-chunk budget, stop submitting further chunks for this cycle
      // (Issue #2380). Throughput is effectively zero so additional chunks
      // would likely consume the rest of the budget without returning.
      if (ctx.perChunkMaxMs > 0 && chunkElapsed >= ctx.perChunkMaxMs) {
        if (shouldLogDiscovery(config)) {
          getLogger().info(
            `Discovery ${
              blue(ID)
            } rust combined analysis chunk ${chunkIdx}/${chunks.length} exceeded per-chunk budget ${
              yellow(format(ctx.perChunkMaxMs, { ignoreZero: true }))
            } (elapsed ${
              yellow(format(chunkElapsed, { ignoreZero: true }))
            }); aborting remaining chunks`,
          );
        }
        iterationStalled = true;
        break;
      }

      // Overall deadline check between chunks so we don't start a new chunk
      // when there is effectively no budget remaining.
      const chunkTimeRemaining = ctx.getTimeoutTS() - now();
      if (chunkTimeRemaining <= 0) {
        iterationStalled = true;
        break;
      }
    }

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

    if (iterationStalled) {
      stalledFlag = true;
      if (shouldLogDiscovery(config)) {
        getLogger().info(
          `Discovery ${
            blue(ID)
          } analysis throughput stalled after evaluating ${attemptedNeurons.size} neuron(s); aborting retry loop`,
        );
      }
      break;
    }

    const timeRemaining = ctx.getTimeoutTS() - now();
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
  perfStats.analysisPhaseTime = now() - analysisPhaseStartTime;
  // Surface throughput stall so callers can inspect after the loop returns.
  perfStats.analysisStalled = stalledFlag;

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

/**
 * Renders a short suffix describing which scopes used the GPU for a combined
 * analysis result. Used for per-chunk logging (Issue #2380).
 */
function describeGpuUsage(
  combinedResult:
    | import("./RustDiscovery.ts").RustAnalyzeAllResult
    | undefined,
): string {
  if (!combinedResult) return "";
  const synapseGpu = combinedResult.synapse?.gpuUsed;
  const neuronGpu = combinedResult.neuron?.gpuUsed;
  if (synapseGpu === undefined && neuronGpu === undefined) return "";
  const parts: string[] = [];
  if (synapseGpu !== undefined) {
    parts.push(`synapse=${synapseGpu ? "gpu" : "cpu"}`);
  }
  if (neuronGpu !== undefined) {
    parts.push(`neuron=${neuronGpu ? "gpu" : "cpu"}`);
  }
  return ` [${parts.join(" ")}]`;
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

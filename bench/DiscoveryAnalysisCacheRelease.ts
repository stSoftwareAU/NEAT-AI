/**
 * Benchmark: peak heap impact of per-chunk Rust analysis cache release
 * (Issue #2642).
 *
 * `DiscoverStructure.combinedRustAnalysis` caches the most recent Rust
 * combined-analysis result so adjacent reads (`analyzeSelectedNeurons`,
 * `analyzeMissingNeurons`, etc.) can reuse it without re-invoking the
 * FFI. Inside `runAnalysisLoop` only the per-chunk
 * `collectRustAnalysisCandidates` reads the cache — once candidates have
 * been mapped and accumulated nothing else in the chunk needs it. Before
 * #2642 the cache stayed live until the next chunk's
 * `ensureRustCombinedAnalysis` overwrote it, so peak heap during analysis
 * was roughly:
 *
 *   prior chunk's raw FFI buffers (cache)
 * + next chunk's raw FFI buffers (about to be allocated)
 * + cumulative mapped candidates (accumulator)
 *
 * After #2642 the prior chunk's raw FFI buffers are released as soon as
 * candidates have been mapped, so peak heap drops by roughly one chunk's
 * raw-buffer footprint.
 *
 * Methodology:
 *   - The orchestrator (`main()`) spawns one fresh `deno run` subprocess
 *     per (mode, scenario) so each measurement starts from an empty heap.
 *     Without process isolation the second mode runs after V8 has already
 *     grown its heap from the first, biasing the comparison.
 *   - Each child runs the same chunked loop that mirrors `runAnalysisLoop`
 *     step-for-step (allocate raw FFI buffer → map into mapped bundle →
 *     accumulate → optionally release the cache).
 *   - Peak `heapUsed`, peak `rss`, and CRITICAL-proxy hits are sampled
 *     after every step.
 *
 * Run:
 *   deno run --allow-all bench/DiscoveryAnalysisCacheRelease.ts
 */

import type {
  RustAnalyzeAllResult,
  RustCandidateNeuron,
  RustCandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type {
  CandidateNeuron,
  CandidateSynapse,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";

interface SampleStats {
  mode: "retain" | "release";
  peakUsedMB: number;
  peakRssMB: number;
  criticalHits: number;
  totalCandidates: number;
  chunks: number;
}

const MB = 1024 * 1024;
const CRITICAL_THRESHOLD = 0.85; // matches DEFAULT_MEMORY_CONFIG

// =============================================================================
// Child-process worker
// =============================================================================

function buildChunkResult(focusListLength: number): RustAnalyzeAllResult {
  const synapseCount = Math.max(50, focusListLength * 10);
  const neuronCount = Math.max(25, focusListLength * 5);

  const helpfulSynapses: RustCandidateSynapse[] = Array.from(
    { length: synapseCount },
    (_, i) => ({
      fromNeuronUuid: `from-uuid-${i}-${"x".repeat(8)}`,
      toNeuronUuid: `to-uuid-${i}-${"y".repeat(8)}`,
      weight: i * 0.0001,
      targetNeuronImpact: 0.5,
      expectedCreatureErrorReduction: 0.0001,
      expectedCreatureScoreGain: 0.0001,
      improvedCount: i,
      totalCount: synapseCount,
      comment: `synapse-${i}-padding-${"z".repeat(40)}`,
    }),
  );

  const harmfulSynapses: RustCandidateSynapse[] = Array.from(
    { length: Math.floor(synapseCount / 4) },
    (_, i) => ({
      fromNeuronUuid: `from-h-${i}-${"x".repeat(8)}`,
      toNeuronUuid: `to-h-${i}-${"y".repeat(8)}`,
      weight: -i * 0.0001,
      targetNeuronImpact: 0.25,
      expectedCreatureErrorReduction: -0.0001,
      expectedCreatureScoreGain: -0.0001,
      improvedCount: 0,
      totalCount: synapseCount,
      comment: `harmful-${i}-padding-${"z".repeat(40)}`,
    }),
  );

  const helpfulNeurons: RustCandidateNeuron[] = Array.from(
    { length: neuronCount },
    (_, i) => ({
      sourceNeuronUuid: `source-uuid-${i}-${"x".repeat(8)}`,
      targetNeuronUuid: `target-uuid-${i}-${"y".repeat(8)}`,
      incomingWeight: i * 0.001,
      outgoingWeight: i * 0.002,
      squash: "TANH",
      bias: i * 0.0001,
      targetNeuronImpact: 0.5,
      expectedCreatureErrorReduction: 0.0002,
      expectedCreatureScoreGain: 0.0002,
      improvedCount: i,
      totalCount: neuronCount,
      comment: `neuron-${i}-padding-${"z".repeat(40)}`,
    }),
  );

  const synapseDiagnostics = Array.from(
    { length: focusListLength },
    (_, i) => ({
      focusNeuronUuid: `focus-${i}-${"x".repeat(8)}`,
      reason: "no-improvement",
      detail: `padding-${i}-${"d".repeat(80)}`,
    }),
  );

  const neuronDiagnostics = Array.from(
    { length: focusListLength },
    (_, i) => ({
      focusNeuronUuid: `focus-${i}-${"x".repeat(8)}`,
      reason: "below-threshold",
      detail: `padding-${i}-${"e".repeat(80)}`,
    }),
  );

  return {
    success: true,
    synapse: {
      success: true,
      gpuUsed: false,
      helpfulSynapses,
      harmfulSynapses,
      // deno-lint-ignore no-explicit-any
      diagnostics: synapseDiagnostics as any,
    },
    neuron: {
      success: true,
      gpuUsed: false,
      helpfulNeurons,
      // deno-lint-ignore no-explicit-any
      diagnostics: neuronDiagnostics as any,
    },
  };
}

/** Production-equivalent mapping (mirrors `mapRustCandidate` / `mapRustNeuronCandidate`). */
function mapBundle(
  result: RustAnalyzeAllResult,
): { helpfulSynapses: CandidateSynapse[]; helpfulNeurons: CandidateNeuron[] } {
  const helpfulSynapses: CandidateSynapse[] =
    (result.synapse?.helpfulSynapses ?? []).map((c) => ({
      fromNeuronUuid: c.fromNeuronUuid,
      toNeuronUuid: c.toNeuronUuid,
      weight: c.weight,
      targetNeuronImpact: c.targetNeuronImpact,
      expectedCreatureErrorReduction: c.expectedCreatureErrorReduction,
      expectedCreatureScoreGain: c.expectedCreatureScoreGain,
      improvedCount: c.improvedCount,
      totalCount: c.totalCount,
      comment: c.comment,
      targetNeuronStats: c.targetNeuronStats,
    }));

  const helpfulNeurons: CandidateNeuron[] =
    (result.neuron?.helpfulNeurons ?? []).map((c) => ({
      fromNeuronUuid: c.sourceNeuronUuid,
      toNeuronUuid: c.targetNeuronUuid,
      incomingWeight: c.incomingWeight,
      outgoingWeight: c.outgoingWeight,
      squash: c.squash,
      bias: c.bias,
      targetNeuronImpact: c.targetNeuronImpact,
      expectedCreatureErrorReduction: c.expectedCreatureErrorReduction,
      expectedCreatureScoreGain: c.expectedCreatureScoreGain,
      improvedCount: c.improvedCount,
      totalCount: c.totalCount,
      comment: c.comment,
      targetNeuronStats: c.targetNeuronStats,
    }));

  return { helpfulSynapses, helpfulNeurons };
}

function memSample(): { heapUsed: number; heapTotal: number; rss: number } {
  const m = (globalThis as {
    Deno?: {
      memoryUsage?: () => {
        heapUsed: number;
        heapTotal: number;
        rss: number;
      };
    };
  })
    ?.Deno?.memoryUsage?.();
  if (!m) return { heapUsed: 0, heapTotal: 0, rss: 0 };
  return m;
}

function runAnalysisLoopChild(
  mode: "retain" | "release",
  chunks: number,
  focusListLength: number,
): SampleStats {
  let cache: RustAnalyzeAllResult | undefined;
  const accumulated: {
    synapses: CandidateSynapse[];
    neurons: CandidateNeuron[];
  } = { synapses: [], neurons: [] };
  let totalCandidates = 0;
  let peakUsed = 0;
  let peakRss = 0;
  let criticalHits = 0;

  const observe = () => {
    const s = memSample();
    if (s.heapUsed > peakUsed) peakUsed = s.heapUsed;
    if (s.rss > peakRss) peakRss = s.rss;
    if (s.heapTotal > 0 && s.heapUsed / s.heapTotal >= CRITICAL_THRESHOLD) {
      criticalHits++;
    }
  };

  for (let i = 0; i < chunks; i++) {
    // Step 1: allocate raw FFI result; cache it.
    cache = buildChunkResult(focusListLength);
    observe();

    // Step 2: map raw into fresh CandidateSynapse / CandidateNeuron objects.
    const bundle = mapBundle(cache);
    observe();

    // Step 3 (release mode, early): drop the cached raw FFI buffer now
    // that the bundle holds independent copies. Mirrors the early-release
    // call in DataRecorderAnalysis.runAnalysisLoop's bundle path, placed
    // before the squash analysis allocation peak.
    if (mode === "release") {
      cache = undefined;
    }
    observe();

    // Step 4: simulate the squash-analysis allocation peak. Production
    // loads parquet records per focus neuron and runs activation /
    // derivative analyses — heavy transient allocation that benefits from
    // the cache being released first. Modelled here as a transient
    // Float64Array sized to the focus list.
    const squashTransient = new Float64Array(focusListLength * 4096);
    for (let j = 0; j < squashTransient.length; j += 1024) {
      squashTransient[j] = j;
    }
    observe();
    // Squash result is small — only the per-neuron CandidateSquash entries
    // survive. We don't model them retained here; that cost is identical
    // between modes.

    // Step 5: accumulate into discoverResult (matches accumulateResults).
    accumulated.synapses = [...accumulated.synapses, ...bundle.helpfulSynapses];
    accumulated.neurons = [...accumulated.neurons, ...bundle.helpfulNeurons];
    totalCandidates += bundle.helpfulSynapses.length +
      bundle.helpfulNeurons.length;
    observe();

    // Step 6 (release mode, late): redundant catch-all for the fallback
    // path. In retain mode the cache stays live across the iteration
    // boundary; the next chunk's allocation overwrites it.
    if (mode === "release") {
      cache = undefined;
    }
    observe();
  }

  // Defeat dead-store elimination.
  if (accumulated.synapses.length < 0) console.log("unreachable");
  if (cache && cache.success === false) console.log("unreachable cache");

  return {
    mode,
    peakUsedMB: peakUsed / MB,
    peakRssMB: peakRss / MB,
    criticalHits,
    totalCandidates,
    chunks,
  };
}

// =============================================================================
// Orchestration
// =============================================================================

interface Scenario {
  label: string;
  chunks: number;
  focusListLength: number;
}

const SCENARIOS: Scenario[] = [
  { label: "small chunks (10 × 25 neurons)", chunks: 10, focusListLength: 25 },
  { label: "medium chunks (15 × 50 neurons)", chunks: 15, focusListLength: 50 },
  {
    label: "large chunks (20 × 100 neurons)",
    chunks: 20,
    focusListLength: 100,
  },
];

function pct(before: number, after: number): string {
  if (before === 0) return "n/a";
  return `${(100 * (before - after) / before).toFixed(1)}%`;
}

async function runChild(
  mode: "retain" | "release",
  chunks: number,
  focusListLength: number,
): Promise<SampleStats> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      new URL(import.meta.url).pathname,
      "--child",
      mode,
      String(chunks),
      String(focusListLength),
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout, stderr, code } = await cmd.output();
  if (code !== 0) {
    const err = new TextDecoder().decode(stderr);
    throw new Error(`child exited ${code}: ${err}`);
  }
  const out = new TextDecoder().decode(stdout).trim();
  const lastLine = out.split("\n").filter((l) => l.startsWith("{"))[0];
  if (!lastLine) {
    throw new Error(`no JSON output from child:\n${out}`);
  }
  return JSON.parse(lastLine) as SampleStats;
}

async function main() {
  console.log(
    "Discovery analysis cache release — peak heap benchmark (Issue #2642)",
  );
  console.log(
    "  retain  = pre-#2642 (cache held until next chunk overwrites)",
  );
  console.log(
    "  release = post-#2642 (cache dropped per chunk in runAnalysisLoop)",
  );
  console.log("  Each measurement runs in a fresh subprocess for isolation.\n");

  for (const scenario of SCENARIOS) {
    // Run each mode 3 times in isolated subprocesses and take the median to
    // damp GC timing noise.
    // Sequential awaits are intentional — running children in parallel
    // skews peak heap and RSS measurements because subprocesses contend
    // for the same physical memory.
    const retainRuns: SampleStats[] = [];
    const releaseRuns: SampleStats[] = [];
    for (let i = 0; i < 3; i++) {
      // deno-lint-ignore no-await-in-loop
      const r = await runChild(
        "retain",
        scenario.chunks,
        scenario.focusListLength,
      );
      retainRuns.push(r);
      // deno-lint-ignore no-await-in-loop
      const s = await runChild(
        "release",
        scenario.chunks,
        scenario.focusListLength,
      );
      releaseRuns.push(s);
    }
    const median = (xs: number[]) =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

    const retainPeak = median(retainRuns.map((r) => r.peakUsedMB));
    const releasePeak = median(releaseRuns.map((r) => r.peakUsedMB));
    const retainRss = median(retainRuns.map((r) => r.peakRssMB));
    const releaseRss = median(releaseRuns.map((r) => r.peakRssMB));
    const retainCritical = median(retainRuns.map((r) => r.criticalHits));
    const releaseCritical = median(releaseRuns.map((r) => r.criticalHits));
    const retainCandidates = retainRuns[0].totalCandidates;
    const releaseCandidates = releaseRuns[0].totalCandidates;

    console.log(`\n=== ${scenario.label} (median of 3 runs) ===`);
    console.log(
      `  peak heapUsed:  retain=${retainPeak.toFixed(1)}MB  release=${
        releasePeak.toFixed(1)
      }MB  (reduction ${pct(retainPeak, releasePeak)})`,
    );
    console.log(
      `  peak rss:       retain=${retainRss.toFixed(1)}MB  release=${
        releaseRss.toFixed(1)
      }MB  (reduction ${pct(retainRss, releaseRss)})`,
    );
    console.log(
      `  CRITICAL hits:  retain=${retainCritical}  release=${releaseCritical}  (reduction ${
        pct(retainCritical, releaseCritical)
      })`,
    );
    console.log(
      `  candidates:     retain=${retainCandidates}  release=${releaseCandidates}  (delta ${
        releaseCandidates - retainCandidates
      })`,
    );
  }
}

// =============================================================================
// Entry point
// =============================================================================

if (Deno.args[0] === "--child") {
  const mode = Deno.args[1] as "retain" | "release";
  const chunks = Number(Deno.args[2]);
  const focusListLength = Number(Deno.args[3]);
  const stats = runAnalysisLoopChild(mode, chunks, focusListLength);
  console.log(JSON.stringify(stats));
} else {
  await main();
}

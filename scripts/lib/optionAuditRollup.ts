/**
 * Merged classification table for the #3505 option-removal audit (Issue #3525).
 *
 * This is the consolidated result of slices A–F (#3519–#3524): every option key
 * with its verdict and, where it qualifies, the removal issue that carries it.
 * It is data rather than prose so the coverage check can be mechanical —
 * `optionAuditReconcile.ts` diffs it against the #3518 harness key inventory,
 * and a gap fails CI instead of quietly disappearing from a markdown table.
 *
 * Per-key evidence stays in the slice write-ups: `docs/OPTION_AUDIT_SLICE_A.md`
 * … `docs/OPTION_AUDIT_SLICE_F.md`. The rendered merged table is
 * `docs/OPTION_AUDIT_CONSOLIDATED.md`.
 */

/** The three verdicts the audit assigns. */
export type Verdict = "IN USE" | "KEEP" | "QUALIFIES";

/** A verdict plus the removal/decision issue that carries it, when it has one. */
export interface FieldVerdict {
  verdict: Verdict;
  issue?: number;
}

/** One classified option key: a `NeatArguments` field or an internal config. */
export interface RollupEntry {
  /** Top-level `NeatArguments` key, or an internal config's interface name. */
  key: string;
  /** Audit slice that classified it. */
  slice: "A" | "B" | "C" | "D" | "E" | "F" | "roll-up";
  /** Verdict for the key itself. */
  verdict: Verdict;
  /** Removal or decision issue, required when `verdict` is `QUALIFIES`. */
  issue?: number;
  /**
   * `File.ts::Interface` entries this key's value is shaped by. A nested field
   * reaches `NeatOptions` only through its parent, so its verdict follows the
   * parent unless `fieldDefault` / `fieldOverrides` say otherwise.
   */
  interfaces?: string[];
  /** Verdict for fields not named in `fieldOverrides` (defaults to `verdict`). */
  fieldDefault?: Verdict;
  /** Fields whose verdict differs from `fieldDefault`. */
  fieldOverrides?: Record<string, FieldVerdict>;
  /** True when the config has no `NeatOptions` key (env-resolved internals). */
  internal?: boolean;
  /** Short note carried into the merged table. */
  note?: string;
}

const inUse = (
  key: string,
  slice: RollupEntry["slice"],
  rest: Partial<RollupEntry> = {},
): RollupEntry => ({ key, slice, verdict: "IN USE", ...rest });

const keep = (
  key: string,
  slice: RollupEntry["slice"],
  rest: Partial<RollupEntry> = {},
): RollupEntry => ({ key, slice, verdict: "KEEP", ...rest });

const qualifies = (
  key: string,
  slice: RollupEntry["slice"],
  issue: number,
  rest: Partial<RollupEntry> = {},
): RollupEntry => ({ key, slice, verdict: "QUALIFIES", issue, ...rest });

/**
 * Slice A (#3519) — 46 non-`discovery*` top-level options.
 *
 * Three of slice A's `QUALIFIES` verdicts have been carried out: `maxConns`
 * and `maximumNumberOfNodes` by #3552, and `enableRepetitiveTraining` by
 * #3553. Those keys no longer exist in `NeatArguments`, so the harness no
 * longer enumerates them and their entries are gone from this table. A
 * retained entry would be an orphan (`reconcile()` reports keys the source no
 * longer has).
 */
const SLICE_A: RollupEntry[] = [
  qualifies("dnaSharingMode", "A", 3554, {
    note:
      "Slice F confirmed `DnaSharingPreset.ts` is covered here and filed nothing.",
  }),
  ...[
    "dataSetPartitionBreak",
    "debug",
    "maxCRISPRsPerGeneration",
    "maxDedupRetries",
    "trainingTaskTimeoutMinutes",
    "skipTrainingAfterConsecutiveRegressions",
    "subnetworkIndexSize",
    "trainingBatchSize",
    "disableRandomSamples",
    "maximumBiasAdjustmentScale",
    "maximumWeightAdjustmentScale",
    "globalBreedingRate",
    "diversityBreedingRate",
    "geneticCompatibilityThreshold",
    "interSpeciesCrossoverThreshold",
    "syntheticAlignmentThreshold",
    "allowPoolBorrowing",
    "tolerateCorruptParents",
  ].map((k) => keep(k, "A")),
  ...[
    "populationSize",
    "costName",
    "creativeThinkingConnectionCount",
    "creatures",
    "CRISPRs",
    "customCost",
    "feedbackLoop",
    "focusList",
    "focusRate",
    "costOfGrowth",
    "elitism",
    "timeoutMinutes",
    "trainPerGen",
    "mutationAmount",
    "mutationRate",
    "threads",
    "heavyTaskWorkerCount",
    "selection",
    "iterations",
    "verbose",
    "log",
    "trainingSampleRate",
    "targetError",
    "sparseRatio",
  ].map((k) => inUse(k, "A")),
];

/**
 * Slice B (#3520) — 36 `discovery*` top-level options.
 *
 * Slice B's one `QUALIFIES` verdict, `discoveryReplayDiagnostics`, was carried
 * out by #3556: the key no longer exists in `NeatArguments`, so the harness no
 * longer enumerates it and its entry is gone from this table. A retained entry
 * would be an orphan (`reconcile()` reports keys the source no longer has).
 */
const SLICE_B: RollupEntry[] = [
  ...[
    "discoveryMinRecordCoverage",
    "discoveryHardDeadlineTS",
    "discoveryRustFlushBytes",
    "discoveryAnalysisChunkSize",
    "discoveryAnalysisPerChunkMaxMs",
    "discoveryFailureCacheBypassOnDrought",
    "discoveryReplayMaxSingles",
    "discoveryReplayMaxPairwise",
    "discoveryReplayMaxTriples",
    "discoveryReplayConcurrency",
    "discoveryReplayTimeoutMinutes",
    "discoveryReplayMinTimeMinutes",
    "maxConcurrentDiscoveries",
    "discoveryMinCandidatesPerCategory",
  ].map((k) => keep(k, "B")),
  keep("discoveryCache", "B", {
    interfaces: ["src/config/DiscoveryCacheConfig.ts::DiscoveryCacheConfig"],
  }),
  keep("discoveryDiskSpace", "B", {
    interfaces: ["src/config/DiskSpaceConfig.ts::DiskSpaceConfig"],
  }),
  ...[
    "discoverySampleRate",
    "discoveryRecordTimeOutMinutes",
    "discoveryAnalysisTimeoutMinutes",
    "discoveryBatchSize",
    "discoveryBufferSize",
    "discoveryRustFlushRecords",
    "discoveryMaxNeurons",
    "discoveryDrainEveryNBatches",
    "discoveryFocusNeuronUUIDs",
    "discoveryDisableEvaluationSummaryLogging",
    "checkpointEveryGeneration",
    "discoveryDisableCleanup",
    "discoveryBaseDirectory",
    "discoverySkipRecordPhase",
    "discoveryCacheDir",
    "discoveryFailureCacheDir",
    "discoverySuccessCacheDir",
    "discoveryReplayVerifyScores",
    "discoveryReplayRescoreBaseline",
  ].map((k) => inUse(k, "B")),
];

/**
 * Slice C (#3521) — population & selection nested configs.
 *
 * `ensembleDiversity` was the tenth entry; #3558 removed the option outright.
 * `novelty` was the ninth; #3559 resolved the keep-or-remove decision as
 * remove. Neither has a source key left to classify.
 */
const SLICE_C: RollupEntry[] = [
  qualifies("randomImmigrants", "C", 3560, {
    interfaces: [
      "src/config/RandomImmigrantsConfig.ts::RandomImmigrantsConfig",
    ],
    note: "Decision, audit recommends KEEP — implemented and documented.",
  }),
  keep("selectionPressure", "C", {
    interfaces: [
      "src/config/SelectionPressureConfig.ts::SelectionPressureConfig",
    ],
  }),
  keep("fitnessSharing", "C", {
    interfaces: ["src/config/FitnessSharingConfig.ts::FitnessSharingConfig"],
  }),
  keep("speciesStagnation", "C", {
    interfaces: [
      "src/config/SpeciesStagnationConfig.ts::SpeciesStagnationConfig",
    ],
  }),
  keep("compatibilityGating", "C", {
    interfaces: [
      "src/config/CompatibilityGatingConfig.ts::CompatibilityGatingConfig",
    ],
  }),
  keep("adaptiveMutationThresholds", "C"),
  keep("fineTunePopulation", "C", {
    interfaces: [
      "src/config/FineTunePopulationConfig.ts::FineTunePopulationConfig",
    ],
  }),
  keep("adaptivePopulation", "C", {
    interfaces: [
      "src/config/AdaptivePopulationConfig.ts::AdaptivePopulationConfig",
    ],
    note:
      "Borderline: flag defaults false, but FAST_CONVERGENCE_PRESET turns it on.",
  }),
];

/** Slice D (#3522) — 12 training, regularisation & data-shaping nested configs. */
const SLICE_D: RollupEntry[] = [
  inUse("predictiveCoding", "D", {
    interfaces: [
      "src/config/PredictiveCodingConfig.ts::PredictiveCodingConfig",
    ],
    fieldDefault: "KEEP",
    fieldOverrides: { enabled: { verdict: "IN USE" } },
    note:
      "GRQ sets only `.enabled`; the other four defaults then drive inference.",
  }),
  inUse("outputRanges", "D", {
    interfaces: ["src/config/OutputRangeConfig.ts::OutputRange"],
  }),
  qualifies("stabilityAdaptation", "D", 3562, {
    interfaces: [
      "src/config/StabilityAdaptationConfig.ts::StabilityAdaptationConfig",
    ],
    note: "No implementation exists — parsed, never read.",
  }),
  qualifies("crossValidation", "D", 1943, {
    interfaces: ["src/config/CrossValidationConfig.ts::CrossValidationConfig"],
    note: "Commented on the existing #1943 rather than filing a duplicate.",
  }),
  qualifies("dataFuzzing", "D", 1943, {
    interfaces: ["src/config/DataFuzzingConfig.ts::DataFuzzingConfig"],
    note: "Commented on the existing #1943 rather than filing a duplicate.",
  }),
  qualifies("dataQuantisation", "D", 1943, {
    interfaces: [
      "src/config/DataQuantisationConfig.ts::DataQuantisationConfig",
    ],
    note: "Commented on the existing #1943 rather than filing a duplicate.",
  }),
  qualifies("squashBudget", "D", 3563, {
    interfaces: ["src/config/SquashBudgetConfig.ts::SquashBudgetConfig"],
    note:
      "Decision, audit recommends KEEP — live lever, adoption is a GRQ task.",
  }),
  keep("weightRegularisation", "D", {
    interfaces: [
      "src/config/WeightRegularisationConfig.ts::WeightRegularisationConfig",
    ],
  }),
  keep("biasRegularisation", "D", {
    interfaces: [
      "src/config/BiasRegularisationConfig.ts::BiasRegularisationConfig",
    ],
  }),
  keep("squashEffectiveness", "D", {
    interfaces: [
      "src/config/SquashEffectivenessConfig.ts::SquashEffectivenessConfig",
    ],
  }),
  keep("quantumStep", "D", {
    interfaces: ["src/config/QuantumStepConfig.ts::QuantumStepConfig"],
  }),
  keep("plateauDetection", "D", {
    note:
      "Borderline: flag defaults false, but three exported presets turn it on.",
  }),
];

/** Slice E (#3523) — runtime & infrastructure configs and injection points. */
const SLICE_E: RollupEntry[] = [
  inUse("memory", "E", {
    interfaces: ["src/config/MemoryConfig.ts::MemoryConfig"],
    fieldDefault: "KEEP",
    fieldOverrides: {
      enabled: { verdict: "IN USE" },
      nativeBudgetBytes: { verdict: "IN USE" },
      proactiveGc: { verdict: "QUALIFIES", issue: 3565 },
      maxAnalysisMemoryMb: { verdict: "QUALIFIES", issue: 3565 },
    },
    note: "GRQ sets `enabled` + `nativeBudgetBytes`; seven defaults are live.",
  }),
  inUse("workerThreadCap", "E", {
    interfaces: ["src/config/WorkerThreadCapConfig.ts::WorkerThreadCapConfig"],
    note:
      "Env-only (DISCOVERY_*_MB) — zero camelCase hits, still load-bearing.",
  }),
  keep("parallelEvaluation", "E", {
    interfaces: [
      "src/config/ParallelEvaluationConfig.ts::ParallelEvaluationConfig",
    ],
    fieldOverrides: {
      maxConcurrentEvaluations: { verdict: "QUALIFIES", issue: 3566 },
    },
  }),
  keep("wasmCache", "E", {
    interfaces: ["src/config/WasmCacheConfig.ts::WasmCacheConfig"],
    note:
      "GRQ's 50 `wasmCache` hits are its own unrelated cap — a false IN USE.",
  }),
  ...["creatureStore", "experimentStore", "traceStore", "onTrainingEvent"].map((
    k,
  ) => inUse(k, "E")),
  keep("logger", "E", {
    note: "Kept on the resolution path, not the injection.",
  }),
  keep("rng", "E", {
    note: "Checked as a pair with input-only `seed`; both stay.",
  }),
  {
    key: "RustScorerConfig",
    slice: "E",
    verdict: "IN USE",
    internal: true,
    interfaces: [
      "src/config/RustScorerConfig.ts::RustScorerConfig",
      "src/config/RustScorerConfig.ts::RequiredRustScorerConfig",
    ],
    fieldOverrides: { env: { verdict: "KEEP" } },
    note: "No NeatOptions key — resolved from NEAT_AI_RUST_SCORER_* env.",
  },
];

/** Slice F (#3524) — 4 experimental / research configs, all `QUALIFIES`. */
const SLICE_F: RollupEntry[] = [
  qualifies("mcmc", "F", 3570, {
    interfaces: [
      "src/config/MCMCConfig.ts::MCMCConfig",
      "src/config/MCMCConfig.ts::DiversityAwareMCMCConfig",
    ],
    note:
      "Decision — GRQ's evolution-mode sweep declares intent but never wires it.",
  }),
  qualifies("opd", "F", 3570, {
    interfaces: ["src/config/OpdConfig.ts::OpdConfig"],
    note: "Decision — filed jointly with `mcmc`.",
  }),
  qualifies("hyperparameterEvolution", "F", 3569, {
    interfaces: [
      "src/config/HyperparameterConfig.ts::HyperparameterEvolutionConfig",
      "src/config/HyperparameterConfig.ts::EvolvableHyperparameters",
    ],
  }),
  qualifies("specialist", "F", 3568, {
    interfaces: ["src/config/SpecialistConfig.ts::SpecialistConfig"],
    note: "Option surface is unreadable at any value.",
  }),
];

/**
 * Keys the roll-up itself classified because no slice covered them.
 *
 * The six slice briefs were built from a grep that skipped `readonly mutation`
 * — the "118 top-level fields" figure in #3518 and #3525. The parser-backed
 * harness enumerates 119, and this is the difference. Re-probed with the
 * slice method (`git grep`, exit code checked, controls run): GRQ sets it in
 * four `NeatOptions` literals from its `--mutation=ALL|FFW` operator flag.
 */
const ROLLUP_GAP_FILLS: RollupEntry[] = [
  inUse("mutation", "roll-up", {
    note:
      "Gap found by this roll-up. GRQ `src/{exchange,fx,industry,location}/EvolveApp.ts` set it.",
  }),
];

/** The merged classification table — every option key, one entry each. */
export const OPTION_AUDIT_ROLLUP: readonly RollupEntry[] = [
  ...SLICE_A,
  ...SLICE_B,
  ...SLICE_C,
  ...SLICE_D,
  ...SLICE_E,
  ...SLICE_F,
  ...ROLLUP_GAP_FILLS,
];

/**
 * Every issue number attached to each key, key-level and field-level.
 *
 * The duplicate tripwire: a key mapping to two issue numbers means two slices
 * filed against the same option, which is the failure signature the roll-up
 * brief names.
 */
export function removalIssuesByKey(
  entries: readonly RollupEntry[],
): Map<string, number[]> {
  const byKey = new Map<string, Set<number>>();
  const add = (key: string, issue: number | undefined) => {
    if (issue === undefined) return;
    const set = byKey.get(key) ?? new Set<number>();
    set.add(issue);
    byKey.set(key, set);
  };

  for (const entry of entries) {
    add(entry.key, entry.issue);
    for (const [field, fv] of Object.entries(entry.fieldOverrides ?? {})) {
      add(`${entry.key}.${field}`, fv.issue);
    }
  }
  return new Map(
    [...byKey].map(([key, set]) => [key, [...set].sort((a, b) => a - b)]),
  );
}

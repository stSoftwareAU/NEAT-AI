/**
 * Issue #3930 — Stage 1 of the surrogate feasibility study: the arithmetic
 * that decides whether a fitness-approximation model is possible at all.
 *
 * The question is not "can a model be fitted?" — one always can. It is whether
 * a model fitted to the Issue #3929 evaluation archive **ranks unseen
 * creatures better than the free baseline the search already has**, which is
 * the parent's own exact score. Everything here exists to make that
 * comparison honest:
 *
 * - **Splits are by lineage and by run, never by random row.** Creatures
 *   within a run are near-copies of one another, so a random split puts a
 *   creature's own siblings in the training set and reports a correlation that
 *   is leakage, not prediction. That is the single easiest way to get a false
 *   positive here, and this module offers no random-split mode at all.
 * - **The parent's-score baseline is reported beside every model**, and is
 *   deliberately given information the models are denied — see
 *   {@link parentScoreBaseline}.
 * - **Accuracy is stratified by the true score gap.** An aggregate ρ earned on
 *   pairs that differ in the third decimal says nothing about the ~1e-05
 *   margins this lineage's accepted improvements actually live at.
 *
 * **Score convention.** Records carry `score`, where higher is better. The
 * rank arithmetic in `rankFidelity.ts` is written for errors (lower better),
 * so every vector is negated on the way in. Rank statistics are invariant
 * under that flip; top-k is not, which is precisely why it is done explicitly
 * here rather than left to the reader.
 *
 * Silent-failure guard: a fold that cannot be measured is reported as
 * unmeasurable **with its reason**, never as a zero, and never dropped from
 * the counts.
 *
 * @module surrogateStudy
 */

import type { EvaluationArchiveRecord } from "@archive/EvaluationArchiveFormat.ts";
import {
  DESCRIPTOR_V1_FIELD_NAMES,
  DESCRIPTOR_V1_SCALAR_NAMES,
  NO_REFERENCE_DISTANCE,
} from "@archive/EvaluationDescriptor.ts";
import { kendallTau, spearmanRho, topKAgreement } from "./rankFidelity.ts";
import type { SurrogateFamily, TrainingPoint } from "./surrogateModels.ts";

/** The `k`s the study reports, as the issue's acceptance list names them. */
export const REPORTED_TOP_K: readonly number[] = Object.freeze([1, 3, 5]);

/** Held-out sets smaller than this carry no ordering to score. */
const MIN_HELD_OUT = 2;

/** Training sets smaller than this cannot fit any family. */
const MIN_TRAINING = 3;

/**
 * The share of records that must name an archived parent before the gate can
 * be decided. Below it the baseline is not an ordering, it is a constant.
 */
export const MIN_BASELINE_COVERAGE = 0.5;

/** Slot index of the one relative descriptor entry. */
const REFERENCE_SLOT = DESCRIPTOR_V1_SCALAR_NAMES.indexOf(
  "geneticDistanceToReference",
);

/**
 * The feature names the study fits against: the v1 descriptor slots, plus the
 * indicator that says whether the relative slot carries a real measurement.
 */
export const STUDY_FEATURE_NAMES: readonly string[] = Object.freeze([
  ...DESCRIPTOR_V1_FIELD_NAMES,
  "hasReference",
]);

/**
 * Expand an archived descriptor into the study's feature vector.
 *
 * `geneticDistanceToReference` carries {@link NO_REFERENCE_DISTANCE} when the
 * generation had no fittest to measure against. Left as `-1` it would enter a
 * regression as a distance smaller than every real one, which is not what it
 * means. It is split into a value slot (zeroed when absent) and an indicator,
 * so "no reference" is a fact the model can use rather than a number it will
 * misread.
 */
export function expandDescriptor(
  descriptor: readonly number[],
): number[] {
  if (REFERENCE_SLOT < 0) {
    throw new Error(
      "the v1 descriptor no longer has a geneticDistanceToReference slot — " +
        "this study's feature expansion is out of date with the archive",
    );
  }
  const features = [...descriptor];
  const absent = features[REFERENCE_SLOT] === NO_REFERENCE_DISTANCE;
  if (absent) features[REFERENCE_SLOT] = 0;
  features.push(absent ? 0 : 1);
  return features;
}

/** How a study holds creatures out. */
export type SplitMode = "lineage" | "run";

/**
 * Group every record by lineage: a creature and the parents it was bred from
 * share a group, transitively.
 *
 * A parent that is not itself in the archive cannot join anything, so an
 * archive that lost its early generations degrades into more, smaller
 * lineages rather than into a wrong grouping.
 *
 * @returns Creature UUID → lineage identifier (the smallest UUID in the group).
 */
export function lineageGroups(
  records: readonly EvaluationArchiveRecord[],
): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (uuid: string): string => {
    let root = uuid;
    for (let next = parent.get(root); next !== root; next = parent.get(root)) {
      if (next === undefined) {
        // Every node reachable here was added before any union ran, so an
        // absent link means the index is corrupt. Walking on would spin
        // forever instead of saying so.
        throw new Error(`lineage index has no entry for ${root}`);
      }
      root = next;
    }
    let walk = uuid;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk) ?? root;
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  const add = (uuid: string): void => {
    if (!parent.has(uuid)) parent.set(uuid, uuid);
  };
  for (const record of records) add(record.uuid);
  for (const record of records) {
    for (const ancestor of record.parents ?? []) {
      if (!parent.has(ancestor)) continue;
      const a = find(record.uuid);
      const b = find(ancestor);
      if (a === b) continue;
      // Union by UUID order, so the representative is deterministic.
      if (a < b) parent.set(b, a);
      else parent.set(a, b);
    }
  }
  const groups = new Map<string, string>();
  for (const record of records) groups.set(record.uuid, find(record.uuid));
  return groups;
}

/**
 * The fraction of records that name at least one parent **which is itself in
 * the archive**.
 *
 * This is the study's own precondition, measured rather than assumed. The kill
 * gate is defined against the parent's exact score, so an archive whose parent
 * links are mostly absent cannot decide the gate at all — and a lineage split
 * over such an archive silently degenerates into leave-one-creature-out, which
 * is the leaky split the issue forbids. Both failures are invisible unless
 * this number is on the report.
 */
export function lineageCoverage(
  records: readonly EvaluationArchiveRecord[],
): number {
  if (records.length === 0) return 0;
  const known = new Set(records.map((record) => record.uuid));
  let linked = 0;
  for (const record of records) {
    if ((record.parents ?? []).some((uuid) => known.has(uuid))) linked++;
  }
  return linked / records.length;
}

/** The group key each record belongs to under a split mode. */
export function groupKeys(
  records: readonly EvaluationArchiveRecord[],
  mode: SplitMode,
): Map<string, string> {
  if (mode === "run") {
    const keys = new Map<string, string>();
    for (const record of records) keys.set(record.uuid, record.runId);
    return keys;
  }
  return lineageGroups(records);
}

/** One leave-one-group-out fold. */
export interface StudyFold {
  /** The group that was held out. */
  readonly group: string;
  readonly train: readonly EvaluationArchiveRecord[];
  readonly test: readonly EvaluationArchiveRecord[];
}

/** A fold that could not be run, and why — counted, never dropped silently. */
export interface SkippedFold {
  readonly group: string;
  readonly reason: string;
}

/** The folds a split mode yields, and the ones it could not yield. */
export interface FoldSplit {
  readonly mode: SplitMode;
  /** The rule, in words, for the report. Never inferred by the reader. */
  readonly rule: string;
  readonly folds: readonly StudyFold[];
  readonly skipped: readonly SkippedFold[];
}

/**
 * Build leave-one-group-out folds.
 *
 * Every group becomes one fold: it is the held-out set, and every other group
 * is the training set. A group too small to rank, or one whose removal leaves
 * too little to fit, is recorded in `skipped` with its reason.
 *
 * A record whose UUID appears more than once — the same creature scored in two
 * generations — is de-duplicated to its first occurrence, because holding out
 * a creature whose identical twin sits in the training set is the same leak a
 * random split causes.
 */
export function buildFolds(
  records: readonly EvaluationArchiveRecord[],
  mode: SplitMode,
): FoldSplit {
  const unique: EvaluationArchiveRecord[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.uuid)) continue;
    seen.add(record.uuid);
    unique.push(record);
  }
  const keys = groupKeys(unique, mode);
  const byGroup = new Map<string, EvaluationArchiveRecord[]>();
  for (const record of unique) {
    const key = keys.get(record.uuid) ?? record.uuid;
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(record);
    else byGroup.set(key, [record]);
  }
  const folds: StudyFold[] = [];
  const skipped: SkippedFold[] = [];
  for (
    const [group, test] of [...byGroup].sort((a, b) => a[0] < b[0] ? -1 : 1)
  ) {
    const train = unique.filter((record) => keys.get(record.uuid) !== group);
    if (test.length < MIN_HELD_OUT) {
      skipped.push({
        group,
        reason: `only ${test.length} creature held out — no ordering to score`,
      });
      continue;
    }
    if (train.length < MIN_TRAINING) {
      skipped.push({
        group,
        reason: `only ${train.length} creatures left to train on`,
      });
      continue;
    }
    folds.push({ group, train, test });
  }
  return {
    mode,
    rule: mode === "lineage"
      ? "leave-one-lineage-out: a creature and every ancestor it was bred " +
        "from that is present in the archive form one group, and the whole " +
        "group is held out together"
      : "leave-one-run-out: every creature archived by one run id is held " +
        "out together",
    folds,
    skipped,
  };
}

/** A prediction rule the study can score, model or baseline. */
export interface StudyPredictor {
  readonly name: string;
  /** Whether this is the free baseline rather than a fitted model. */
  readonly isBaseline: boolean;
  /**
   * Predict every held-out score from the training records.
   *
   * Returns one number per test record, in order. Throws when the rule cannot
   * be applied to this fold at all — the caller records that as an
   * unmeasurable fold rather than as a bad score.
   */
  readonly predict: (fold: StudyFold) => number[];
}

/** Wrap a model family as a predictor over archive records. */
export function modelPredictor(family: SurrogateFamily): StudyPredictor {
  return {
    name: family.name,
    isBaseline: false,
    predict(fold: StudyFold): number[] {
      const points: TrainingPoint[] = fold.train.map((record) => ({
        features: expandDescriptor(record.descriptor),
        score: record.score,
      }));
      const model = family.fit(points);
      return fold.test.map((record) =>
        model.predict(expandDescriptor(record.descriptor)).mean
      );
    },
  };
}

/**
 * The free baseline: rank an offspring by its parents' exact score.
 *
 * It is given the parent's score **from the whole archive**, including the
 * held-out fold, where the models see only the training split. That asymmetry
 * is deliberate and it is the whole point of the gate: in a real search the
 * parent was evaluated in the previous generation, so its exact score is
 * already on hand and costs nothing. A surrogate that cannot beat a number the
 * search is holding anyway is worse than nothing, because it costs something.
 *
 * A creature with no archived parent — a seed, an elite, a random immigrant —
 * has no baseline prediction. It falls back to the mean training score, and
 * the fallback is counted, because a baseline that fell back for most of a
 * fold is a degenerate ordering and the report has to say so.
 */
export function parentScoreBaseline(
  records: readonly EvaluationArchiveRecord[],
): StudyPredictor & { readonly fallbacks: () => number } {
  const scoreByUuid = new Map<string, number>();
  for (const record of records) {
    if (!scoreByUuid.has(record.uuid)) {
      scoreByUuid.set(record.uuid, record.score);
    }
  }
  let fallbacks = 0;
  return {
    name: "parent-score-baseline",
    isBaseline: true,
    fallbacks: () => fallbacks,
    predict(fold: StudyFold): number[] {
      const trainMean = fold.train.reduce((sum, r) => sum + r.score, 0) /
        fold.train.length;
      return fold.test.map((record) => {
        const parents = (record.parents ?? [])
          .map((uuid) => scoreByUuid.get(uuid))
          .filter((score): score is number => score !== undefined);
        if (parents.length === 0) {
          fallbacks++;
          return trainMean;
        }
        return parents.reduce((sum, score) => sum + score, 0) / parents.length;
      });
    },
  };
}

/** Rank agreement between a true and a predicted ordering over one fold. */
export interface RankSummary {
  readonly spearman: number | null;
  readonly kendall: number | null;
  /** Top-k agreement, keyed by k. `null` where k exceeds the held-out set. */
  readonly topK: ReadonlyMap<number, number | null>;
  /** Why a statistic is `null`, or `null` when everything was measurable. */
  readonly unmeasurable: string | null;
}

/**
 * Rank agreement for one fold.
 *
 * Both vectors are scores (higher is better) and are negated into the error
 * convention `rankFidelity.ts` is written for. A constant vector — every
 * creature predicted alike, which is exactly what a degenerate baseline does —
 * has no ordering, so the correlations are reported as unmeasurable with that
 * reason rather than as zero.
 */
export function rankSummary(
  trueScores: readonly number[],
  predicted: readonly number[],
): RankSummary {
  const truth = trueScores.map((score) => -score);
  const guess = predicted.map((score) => -score);
  const topK = new Map<number, number | null>();
  let unmeasurable: string | null = null;
  let spearman: number | null = null;
  let kendall: number | null = null;
  try {
    spearman = spearmanRho(truth, guess);
    kendall = kendallTau(truth, guess);
  } catch (error) {
    unmeasurable = error instanceof Error ? error.message : String(error);
  }
  for (const k of REPORTED_TOP_K) {
    if (k > truth.length) {
      topK.set(k, null);
      unmeasurable ??= `top-${k} needs ${k} held-out creatures, fold has ` +
        `${truth.length}`;
      continue;
    }
    topK.set(k, topKAgreement(truth, guess, k));
  }
  return { spearman, kendall, topK, unmeasurable };
}

/** A band of true score gaps, and how well a predictor ordered pairs in it. */
export interface GapBand {
  readonly label: string;
  /** Inclusive lower edge, exclusive of zero-gap pairs. */
  readonly minGap: number;
  /** Inclusive upper edge; `null` for the open tail. */
  readonly maxGap: number | null;
}

/** Pair-ordering accuracy within one gap band. */
export interface BandAccuracy {
  readonly band: GapBand;
  readonly pairs: number;
  readonly correct: number;
  /** `correct / pairs`, or `null` when the band held no pair. */
  readonly accuracy: number | null;
}

/**
 * The bands the study reports, given the margin selection actually operates
 * at. The cumulative `<= acceptGap` band is reported alongside the disjoint
 * ones because it is the band the issue names, and an aggregate that hides
 * poor resolution below it is the failure mode this study exists to avoid.
 */
export function defaultGapBands(acceptGap: number): GapBand[] {
  if (!(acceptGap > 0) || !Number.isFinite(acceptGap)) {
    throw new Error(`accept gap must be a positive number, got ${acceptGap}`);
  }
  const fine = acceptGap / 10;
  return [
    { label: `<=${fine.toExponential(0)}`, minGap: 0, maxGap: fine },
    {
      label: `(${fine.toExponential(0)}, ${acceptGap.toExponential(0)}]`,
      minGap: fine,
      maxGap: acceptGap,
    },
    {
      label: `<=${acceptGap.toExponential(0)} (cumulative)`,
      minGap: 0,
      maxGap: acceptGap,
    },
    {
      label: `>${acceptGap.toExponential(0)}`,
      minGap: acceptGap,
      maxGap: null,
    },
  ];
}

/**
 * Count correctly ordered pairs per gap band.
 *
 * A pair the truth does not separate is skipped — there is no ordering to get
 * right. A **predicted tie** over a pair the truth separates counts as wrong:
 * a surrogate that cannot tell two creatures apart has not ordered them, and
 * counting it as half a success would flatter every degenerate model in the
 * table.
 */
export function gapStratifiedAccuracy(
  trueScores: readonly number[],
  predicted: readonly number[],
  bands: readonly GapBand[],
): BandAccuracy[] {
  if (trueScores.length !== predicted.length) {
    throw new Error(
      `score vectors differ in length: ${trueScores.length} vs ` +
        `${predicted.length}`,
    );
  }
  const pairs = bands.map(() => 0);
  const correct = bands.map(() => 0);
  for (let i = 0; i < trueScores.length; i++) {
    for (let j = i + 1; j < trueScores.length; j++) {
      const gap = Math.abs(trueScores[i] - trueScores[j]);
      if (gap === 0) continue;
      const ordered = predicted[i] !== predicted[j] &&
        Math.sign(trueScores[i] - trueScores[j]) ===
          Math.sign(predicted[i] - predicted[j]);
      for (let b = 0; b < bands.length; b++) {
        const band = bands[b];
        const above = band.minGap === 0 ? gap > 0 : gap > band.minGap;
        const below = band.maxGap === null ? true : gap <= band.maxGap;
        if (!above || !below) continue;
        pairs[b]++;
        if (ordered) correct[b]++;
      }
    }
  }
  return bands.map((band, b) => ({
    band,
    pairs: pairs[b],
    correct: correct[b],
    accuracy: pairs[b] === 0 ? null : correct[b] / pairs[b],
  }));
}

/** What one predictor achieved over one split mode. */
export interface PredictorResult {
  readonly name: string;
  readonly isBaseline: boolean;
  /** Folds where the predictor produced an ordering. */
  readonly measuredFolds: number;
  /** Folds it could not be applied to, with reasons. */
  readonly failedFolds: readonly SkippedFold[];
  /** Mean Spearman ρ over the folds where it was measurable. */
  readonly spearman: number | null;
  /** Mean Kendall τ over the folds where it was measurable. */
  readonly kendall: number | null;
  /** Mean top-k agreement, keyed by k. */
  readonly topK: ReadonlyMap<number, number | null>;
  /** Pair accuracy per gap band, pooled across folds. */
  readonly bands: readonly BandAccuracy[];
}

/** Mean of the non-null entries, or `null` when there were none. */
function meanOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/**
 * Score one predictor over every fold of a split.
 *
 * A fold the predictor throws on — a family that cannot be fitted to it, a
 * training set with no ordering — is recorded in `failedFolds` with the
 * thrown message. It is never counted as a zero: "this model could not be
 * fitted here" and "this model ranked at chance here" are different findings
 * and the table must not blend them.
 */
export function evaluatePredictor(
  split: FoldSplit,
  predictor: StudyPredictor,
  bands: readonly GapBand[],
): PredictorResult {
  const spearmans: (number | null)[] = [];
  const kendalls: (number | null)[] = [];
  const topKValues = new Map<number, (number | null)[]>(
    REPORTED_TOP_K.map((k) => [k, []]),
  );
  const pooled = bands.map(() => ({ pairs: 0, correct: 0 }));
  const failedFolds: SkippedFold[] = [];
  let measuredFolds = 0;
  for (const fold of split.folds) {
    const trueScores = fold.test.map((record) => record.score);
    let predicted: number[];
    try {
      predicted = predictor.predict(fold);
    } catch (error) {
      failedFolds.push({
        group: fold.group,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (predicted.length !== trueScores.length) {
      throw new Error(
        `${predictor.name} returned ${predicted.length} predictions for a ` +
          `${trueScores.length}-creature fold`,
      );
    }
    if (predicted.some((value) => !Number.isFinite(value))) {
      failedFolds.push({
        group: fold.group,
        reason: "the predictor returned a non-finite score",
      });
      continue;
    }
    measuredFolds++;
    const summary = rankSummary(trueScores, predicted);
    spearmans.push(summary.spearman);
    kendalls.push(summary.kendall);
    for (const k of REPORTED_TOP_K) {
      topKValues.get(k)?.push(summary.topK.get(k) ?? null);
    }
    const foldBands = gapStratifiedAccuracy(trueScores, predicted, bands);
    for (let b = 0; b < bands.length; b++) {
      pooled[b].pairs += foldBands[b].pairs;
      pooled[b].correct += foldBands[b].correct;
    }
  }
  return {
    name: predictor.name,
    isBaseline: predictor.isBaseline,
    measuredFolds,
    failedFolds,
    spearman: meanOrNull(spearmans),
    kendall: meanOrNull(kendalls),
    topK: new Map(
      REPORTED_TOP_K.map((k) => [k, meanOrNull(topKValues.get(k) ?? [])]),
    ),
    bands: bands.map((band, b) => ({
      band,
      pairs: pooled[b].pairs,
      correct: pooled[b].correct,
      accuracy: pooled[b].pairs === 0
        ? null
        : pooled[b].correct / pooled[b].pairs,
    })),
  };
}

/** The gate that decides whether Stage 2 is allowed to exist. */
export interface KillGateVerdict {
  /** `true` only when a model beat the baseline on lineage-held-out top-5. */
  readonly passed: boolean;
  /** The baseline's lineage-held-out mean top-5 agreement. */
  readonly baselineTop5: number | null;
  /** The best model's name and top-5, or `null` when none was measurable. */
  readonly best: { readonly name: string; readonly top5: number } | null;
  /** Everything the verdict rests on, in words. */
  readonly reasons: readonly string[];
}

/**
 * Apply the issue's kill gate to the lineage-held-out results.
 *
 * Fail-loud by construction: an undecidable gate — an archive whose parent
 * links are too sparse to build the baseline from, no measurable baseline, no
 * measurable model — is **not** a pass. Stage 2 is expensive and permanent;
 * "we could not tell" must stop it exactly as a clear negative does.
 *
 * @param results - Every predictor's lineage-held-out result, baseline included.
 * @param baselineCoverage - {@link lineageCoverage} of the archive.
 */
export function assessKillGate(
  results: readonly PredictorResult[],
  baselineCoverage: number,
): KillGateVerdict {
  const reasons: string[] = [];
  const baseline = results.find((result) => result.isBaseline);
  if (baseline === undefined) {
    throw new Error(
      "the parent's-score baseline is missing from the results — the kill " +
        "gate is defined against it and cannot be applied without it",
    );
  }
  if (!(baselineCoverage >= MIN_BASELINE_COVERAGE)) {
    reasons.push(
      `only ${(baselineCoverage * 100).toFixed(1)}% of archived creatures ` +
        `name a parent that is also in the archive, below the ` +
        `${(MIN_BASELINE_COVERAGE * 100).toFixed(0)}% this gate needs — the ` +
        "parent's-score baseline is mostly the training mean, so nothing can " +
        "be shown to beat it and the gate is undecidable",
    );
    return {
      passed: false,
      baselineTop5: baseline.topK.get(5) ?? null,
      best: null,
      reasons,
    };
  }
  const baselineTop5 = baseline.topK.get(5) ?? null;
  if (baselineTop5 === null) {
    reasons.push(
      "the baseline's top-5 agreement was not measurable, so no model can be " +
        "shown to beat it",
    );
    return { passed: false, baselineTop5, best: null, reasons };
  }
  let best: { name: string; top5: number } | null = null;
  for (const result of results) {
    if (result.isBaseline) continue;
    const top5 = result.topK.get(5) ?? null;
    if (top5 === null) {
      reasons.push(`${result.name}: top-5 agreement was not measurable`);
      continue;
    }
    if (best === null || top5 > best.top5) best = { name: result.name, top5 };
  }
  if (best === null) {
    reasons.push("no model family produced a measurable top-5 agreement");
    return { passed: false, baselineTop5, best: null, reasons };
  }
  const passed = best.top5 > baselineTop5;
  reasons.push(
    `best model ${best.name} scored ${best.top5.toFixed(3)} against the ` +
      `baseline's ${baselineTop5.toFixed(3)} on lineage-held-out top-5 ` +
      `agreement — ${passed ? "the gate passes" : "the gate fails"}`,
  );
  return { passed, baselineTop5, best, reasons };
}

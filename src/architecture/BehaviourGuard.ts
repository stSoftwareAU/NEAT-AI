/**
 * Probe-based behaviour verification for structural passes (Issue #3840).
 *
 * Compaction and simplification advertise **exact, behaviour-preserving** folds
 * — and therefore a score that cannot regress — while low-impact discovery
 * removal advertises a bounded impact. Nothing verified any of those claims:
 * the guarantee lived in a doc comment and was enforced nowhere, so a pass that
 * broke `IF` routing could publish a creature whose score had fallen by 0.10+
 * with no signal at all.
 *
 * This module supplies the missing check. It feeds a deterministic set of probe
 * rows through the creature before and after a pass and measures how far the
 * outputs moved. A pass that claims exactness must not move them beyond float32
 * noise; a pass that claims a bounded impact must stay inside its own bound.
 *
 * Scoring is dataset-bound and these passes are dataset-free, so the check is
 * on **behaviour** rather than on a score. That is the stronger claim: a
 * creature whose outputs are unchanged scores identically on every dataset.
 *
 * @module
 */

import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { cloneCreatureExport } from "@compact/CloneCreatureExport.ts";
import { getLogger } from "@utils/Logger.ts";

/** Probe rows fed through both creatures when the caller does not choose. */
export const DEFAULT_PROBE_ROWS = 24;

/** Seed of the probe generator — fixed so every run compares the same rows. */
const DEFAULT_PROBE_SEED = 1_234_567;

/**
 * Input magnitudes cycled across probe rows. Grafted `IF` thresholds routinely
 * sit outside [-1, 1], so probing a single scale would leave whole branches
 * untested.
 */
const PROBE_SCALES = [1, 3, 0.25] as const;

/**
 * Output differences at or below this are float32 activation noise rather than
 * a defect: an exact fold still re-associates sums, and WASM activation runs in
 * f32.
 */
export const BEHAVIOUR_NOISE_FLOOR = 1e-5;

/** Relative bound for a pass that claims exact behaviour preservation. */
export const EXACT_BEHAVIOUR_TOLERANCE = 1e-4;

/**
 * Relative bound for a discovery removal that advertises negligible impact.
 * Deliberately generous: probe rows are synthetic, so the check targets gross
 * breakage (flipped routing, a dropped branch) rather than fine drift.
 */
export const LOW_IMPACT_BEHAVIOUR_ALLOWANCE = 0.05;

/**
 * Floor for the output magnitude the deviation is measured against, so a
 * creature whose outputs happen to sit near zero is not judged against a
 * vanishing scale.
 */
const OUTPUT_SCALE_FLOOR = 1e-3;

/** Options controlling how the probe rows are generated. */
export interface BehaviourProbeOptions {
  /** Number of probe rows (default {@link DEFAULT_PROBE_ROWS}). */
  samples?: number;
  /** Seed of the deterministic probe generator. */
  seed?: number;
}

/** How far a candidate's outputs moved from the original's. */
export interface BehaviourDeviation {
  /** Probe rows compared. */
  rows: number;
  /** Individual output values compared. */
  comparisons: number;
  /** Worst absolute output difference seen. */
  worstDelta: number;
  /** Mean absolute output difference across every comparison. */
  meanDelta: number;
  /** Magnitude of the original's outputs the differences are judged against. */
  scale: number;
  /**
   * True when the shapes did not match, when nothing could be compared, or when
   * the candidate produced a non-finite output where the original did not.
   */
  nonFinite: boolean;
}

/** Outcome of a checkpoint verification, including who is to blame. */
export interface BehaviourVerdict {
  /** True when the candidate is within the contract. */
  ok: boolean;
  /** Name of the first pass that broke the contract, when one was found. */
  pass?: string;
  /** The measured deviation of the final candidate. */
  deviation: BehaviourDeviation;
}

/** Deterministic linear congruential generator — never the global RNG. */
function makeRandom(seed: number): () => number {
  let state = Math.abs(Math.trunc(seed)) % 2_147_483_647;
  if (state === 0) state = 1;
  return () => {
    state = (state * 1_103_515_245 + 12_345) & 0x7fff_ffff;
    return state / 0x7fff_ffff;
  };
}

/**
 * Build the deterministic probe rows a behaviour comparison is measured on.
 *
 * @param inputs - Number of input values each row must carry
 * @param options - Row count and seed
 */
export function buildProbeInputs(
  inputs: number,
  options: BehaviourProbeOptions = {},
): Float32Array[] {
  const samples = options.samples ?? DEFAULT_PROBE_ROWS;
  const random = makeRandom(options.seed ?? DEFAULT_PROBE_SEED);
  const rows: Float32Array[] = [];
  for (let row = 0; row < samples; row++) {
    const scale = PROBE_SCALES[row % PROBE_SCALES.length];
    const values = new Float32Array(inputs);
    for (let i = 0; i < inputs; i++) {
      values[i] = (random() * 2 - 1) * scale;
    }
    rows.push(values);
  }
  return rows;
}

/**
 * Activate `creature` on every probe row and copy out the outputs.
 *
 * The copy matters: `activate` may hand back a buffer it reuses on the next
 * call, so the rows must be snapshotted to be comparable afterwards.
 */
export function probeOutputs(
  creature: Creature,
  probes: Float32Array[],
): Float32Array[] {
  return probes.map((row) => Float32Array.from(creature.activate(row, false)));
}

/** Compare two probe-output sets produced from the same probe rows. */
export function compareProbeOutputs(
  expected: Float32Array[],
  actual: Float32Array[],
): BehaviourDeviation {
  const violation: BehaviourDeviation = {
    rows: 0,
    comparisons: 0,
    worstDelta: Number.POSITIVE_INFINITY,
    meanDelta: Number.POSITIVE_INFINITY,
    scale: OUTPUT_SCALE_FLOOR,
    nonFinite: true,
  };

  if (expected.length === 0 || expected.length !== actual.length) {
    return violation;
  }

  let worstDelta = 0;
  let sumDelta = 0;
  let maxMagnitude = 0;
  let comparisons = 0;

  for (let row = 0; row < expected.length; row++) {
    const expectedRow = expected[row];
    const actualRow = actual[row];
    if (expectedRow.length !== actualRow.length) return violation;

    for (let o = 0; o < expectedRow.length; o++) {
      const before = expectedRow[o];
      const after = actualRow[o];
      // An original that is already non-finite carries no contract to break.
      if (!Number.isFinite(before)) continue;
      if (!Number.isFinite(after)) return { ...violation, rows: expected.length };

      const delta = Math.abs(after - before);
      if (delta > worstDelta) worstDelta = delta;
      sumDelta += delta;
      maxMagnitude = Math.max(maxMagnitude, Math.abs(before));
      comparisons++;
    }
  }

  if (comparisons === 0) return { ...violation, rows: expected.length };

  return {
    rows: expected.length,
    comparisons,
    worstDelta,
    meanDelta: sumDelta / comparisons,
    scale: Math.max(maxMagnitude, OUTPUT_SCALE_FLOOR),
    nonFinite: false,
  };
}

/**
 * Measure how far `after` moved from `before` over a shared set of probe rows.
 *
 * A shape change (different input or output count) is reported as a violation
 * rather than compared.
 */
export function measureBehaviourDeviation(
  before: Creature,
  after: Creature,
  options: BehaviourProbeOptions = {},
): BehaviourDeviation {
  if (before.input !== after.input || before.output !== after.output) {
    return {
      rows: 0,
      comparisons: 0,
      worstDelta: Number.POSITIVE_INFINITY,
      meanDelta: Number.POSITIVE_INFINITY,
      scale: OUTPUT_SCALE_FLOOR,
      nonFinite: true,
    };
  }

  const probes = buildProbeInputs(before.input, options);
  return compareProbeOutputs(
    probeOutputs(before, probes),
    probeOutputs(after, probes),
  );
}

/** True when the deviation is inside the contract of an *exact* pass. */
export function isExactBehaviourPreserved(
  deviation: BehaviourDeviation,
): boolean {
  if (deviation.nonFinite) return false;
  const tolerance = Math.max(
    BEHAVIOUR_NOISE_FLOOR,
    EXACT_BEHAVIOUR_TOLERANCE * deviation.scale,
  );
  return deviation.worstDelta <= tolerance;
}

/**
 * True when the deviation is inside the allowance a deliberately lossy pass
 * advertised. Judged on the mean difference: a genuinely negligible change is
 * negligible across the probe set, not merely on most of it.
 */
export function isWithinBehaviourAllowance(
  deviation: BehaviourDeviation,
  allowedRelative: number,
): boolean {
  if (deviation.nonFinite) return false;
  const allowance = Math.max(
    BEHAVIOUR_NOISE_FLOOR,
    allowedRelative * deviation.scale,
  );
  return deviation.meanDelta <= allowance;
}

/** One-line, log-friendly rendering of a deviation. */
export function describeDeviation(deviation: BehaviourDeviation): string {
  if (deviation.nonFinite) {
    return "outputs were not comparable (shape change or non-finite output)";
  }
  return `worst ${deviation.worstDelta.toExponential(3)}, mean ${
    deviation.meanDelta.toExponential(3)
  } against an output scale of ${deviation.scale.toExponential(3)} over ${
    deviation.comparisons
  } comparisons`;
}

/**
 * Verify a pass that claims exact behaviour preservation, logging loudly when
 * the claim does not hold.
 *
 * @returns True when the candidate may be accepted.
 */
export function verifyExactBehaviour(
  original: Creature,
  candidate: Creature,
  pass: string,
  options: BehaviourProbeOptions = {},
): boolean {
  const deviation = measureBehaviourDeviation(original, candidate, options);
  if (isExactBehaviourPreserved(deviation)) return true;

  getLogger().error(
    `🚨 [${pass}] rejected: the pass claims exact behaviour preservation but ` +
      `changed the creature's outputs — ${describeDeviation(deviation)}`,
  );
  return false;
}

/**
 * Verify a deliberately lossy pass against the impact it advertised, logging
 * loudly when the observed change dwarfs the claim.
 *
 * @returns True when the candidate may be accepted.
 */
export function verifyBoundedBehaviour(
  original: Creature,
  candidate: Creature,
  allowedRelative: number,
  pass: string,
  options: BehaviourProbeOptions = {},
): boolean {
  const deviation = measureBehaviourDeviation(original, candidate, options);
  if (isWithinBehaviourAllowance(deviation, allowedRelative)) return true;

  getLogger().error(
    `🚨 [${pass}] rejected: advertised an impact of ${
      (allowedRelative * 100).toFixed(2)
    }% but moved the creature's outputs by more — ${
      describeDeviation(deviation)
    }`,
  );
  return false;
}

/**
 * Records the intermediate state of a multi-pass pipeline so a behaviour
 * violation can name the pass that caused it.
 *
 * The happy path costs one shallow clone per pass that changed something; the
 * per-pass replay only runs once the final candidate has already failed, so an
 * intact pipeline never pays for the diagnosis.
 */
export class BehaviourCheckpoints {
  readonly #probes: Float32Array[];
  readonly #baseline: Float32Array[];
  readonly #states: { pass: string; state: CreatureExport }[] = [];

  constructor(original: Creature, options: BehaviourProbeOptions = {}) {
    this.#probes = buildProbeInputs(original.input, options);
    this.#baseline = probeOutputs(original, this.#probes);
  }

  /** Snapshot the working export after `pass` changed it. */
  record(pass: string, state: CreatureExport): void {
    this.#states.push({ pass, state: cloneCreatureExport(state) });
  }

  /**
   * Check the finished candidate against the original creature.
   *
   * @param candidate - The creature the pipeline is about to return
   * @param context - Name of the pipeline, used in the failure log
   */
  verify(candidate: Creature, context: string): BehaviourVerdict {
    const deviation = compareProbeOutputs(
      this.#baseline,
      this.#candidateOutputs(candidate),
    );
    if (isExactBehaviourPreserved(deviation)) {
      return { ok: true, deviation };
    }

    const pass = this.#blame();
    getLogger().error(
      `🚨 [${context}] rejected: ${
        pass ?? "the pipeline"
      } changed the creature's outputs, but every pass here claims exact ` +
        `behaviour preservation — ${describeDeviation(deviation)}`,
    );
    return { ok: false, pass, deviation };
  }

  /** Probe the candidate, treating an activation failure as a violation. */
  #candidateOutputs(candidate: Creature): Float32Array[] {
    if (candidate.output !== this.#baseline[0]?.length) return [];
    return probeOutputs(candidate, this.#probes);
  }

  /** First recorded pass whose outputs moved away from its predecessor's. */
  #blame(): string | undefined {
    let previous = this.#baseline;
    for (const { pass, state } of this.#states) {
      let outputs: Float32Array[];
      try {
        outputs = probeOutputs(
          Creature.fromJSON(
            cloneCreatureExport(state),
            false,
            "behaviourGuard",
            { throwOnRecurrent: "never" },
          ),
          this.#probes,
        );
      } catch (error) {
        getLogger().error(
          `🚨 [behaviourGuard] ${pass} left a state that could not be ` +
            `replayed: ${error instanceof Error ? error.message : error}`,
        );
        return pass;
      }
      if (!isExactBehaviourPreserved(compareProbeOutputs(previous, outputs))) {
        return pass;
      }
      previous = outputs;
    }
    return undefined;
  }
}

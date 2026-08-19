/**
 * @module
 *
 * Central registry of every activation function: registers each implementation
 * under its canonical name plus aliases, builds the mutation-weighted random
 * pool, and resolves a name to its `AbstractActivationInterface` (throwing
 * `ActivationError` for unknown names). The single lookup point used across
 * mutation, breeding, and serialisation.
 */

import { assert } from "@std/assert";
import { ActivationError } from "@errors/ActivationError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
// best-practice-ignore: BP-91862f495db6 — HYPOT is deprecated but must stay
// registered so pre-v2.0.0 creatures still deserialise and can be repaired /
// upgraded to SQRT & SQUARE (see src/upgrade/UpgradeTwo.ts). Its
// `mutationProbability` is 0, so evolution never selects it. Issue #3446.
import { HYPOT } from "@deprecated/HYPOT.ts";
// best-practice-ignore: BP-6b1e9a008759 — HYPOTv2 is deprecated but must stay
// registered so pre-v2.0.0 creatures still deserialise and can be repaired /
// upgraded to SQRT & SQUARE (see src/upgrade/UpgradeTwo.ts). Its
// `mutationProbability` is 0, so evolution never selects it. Issue #3447.
import { HYPOTv2 } from "@deprecated/HYPOTv2.ts";
// best-practice-ignore: BP-619a32c95d3a — MEAN is deprecated but must stay
// registered so already-serialised creatures (and CRISPR DNA fragments) that
// carry it still deserialise. The replacement is an IDENTITY neuron with each
// inbound weight divided by the inbound synapse count; there is no automatic
// rewrite, so the registration is load-bearing. Its `mutationProbability` is 0,
// so evolution never selects it. Issue #3448.
import { MEAN } from "@deprecated/MEAN.ts";
import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";
import { IF } from "@methods/activations/aggregate/IF.ts";
import { MAXIMUM } from "@methods/activations/aggregate/MAXIMUM.ts";
import { MINIMUM } from "@methods/activations/aggregate/MINIMUM.ts";
import { ABSOLUTE } from "@methods/activations/types/ABSOLUTE.ts";
import { ArcTan } from "@methods/activations/types/ArcTan.ts";
import { BENT_IDENTITY } from "@methods/activations/types/BENT_IDENTITY.ts";
import { BIPOLAR } from "@methods/activations/types/BIPOLAR.ts";
import { BIPOLAR_SIGMOID } from "@methods/activations/types/BIPOLAR_SIGMOID.ts";
import { COMPLEMENT } from "@methods/activations/types/COMPLEMENT.ts";
import { Cosine } from "@methods/activations/types/Cosine.ts";
import { Cube } from "@methods/activations/types/Cube.ts";
import { ELU } from "@methods/activations/types/ELU.ts";
import { Exponential } from "@methods/activations/types/Exponential.ts";
import { GAUSSIAN } from "@methods/activations/types/GAUSSIAN.ts";
import { GELU } from "@methods/activations/types/GELU.ts";
import { HARD_TANH } from "@methods/activations/types/HARD_TANH.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { ISRU } from "@methods/activations/types/ISRU.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";
import { LeakyReLU } from "@methods/activations/types/LeakyReLU.ts";
import { LogSigmoid } from "@methods/activations/types/LogSigmoid.ts";
import { Mish } from "@methods/activations/types/Mish.ts";
import { ReLU } from "@methods/activations/types/ReLU.ts";
import { ReLU6 } from "@methods/activations/types/ReLU6.ts";
import { SELU } from "@methods/activations/types/SELU.ts";
import { SINE } from "@methods/activations/types/SINE.ts";
import { SOFTMAX } from "@methods/activations/types/SOFTMAX.ts";
import { SOFTSIGN } from "@methods/activations/types/SOFTSIGN.ts";
import { SQRT } from "@methods/activations/types/SQRT.ts";
import { SQUARE } from "@methods/activations/types/SQUARE.ts";
import { STEP } from "@methods/activations/types/STEP.ts";
import { Softplus } from "@methods/activations/types/Softplus.ts";
import { StdInverse } from "@methods/activations/types/StdInverse.ts";
import { Swish } from "@methods/activations/types/Swish.ts";
import { TAN } from "@methods/activations/types/TAN.ts";
import { TANH } from "@methods/activations/types/TANH.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

export interface ActivationOptions {
  aliases?: string[];
  priority?: number;
}

/**
 * https://en.wikipedia.org/wiki/Activation_function
 * https://stats.stackexchange.com/questions/115258/comprehensive-list-of-activation-functions-in-neural-networks-with-pros-cons
 */
export class Activations {
  /**
   * Issue #3796: reserved key in a squash-weights map supplying the default
   * weight for every squash the map does not name explicitly.
   */
  public static readonly SQUASH_WEIGHT_WILDCARD = "*";

  private static readonly MAP: Map<string, AbstractActivationInterface> =
    new Map<string, AbstractActivationInterface>();

  private static readonly WEIGHTED_POOL: string[] = [];

  /**
   * Issue #3263: optional squash allow-list ("squash budget"). When set to a
   * non-empty set of canonical names, {@link pickRandomSquash} only ever
   * returns a squash from this set, so mutation and neuron creation can never
   * introduce a disallowed activation. `null` means no restriction (the
   * default free mix). Follows the same global-instance pattern as the RNG.
   */
  private static allowedSquashes: Set<string> | null = null;

  /**
   * The weighted random pool filtered to {@link allowedSquashes}. Rebuilt by
   * {@link setAllowedSquashes} so the hot `pickRandomSquash` path does no
   * per-call filtering when a budget is active.
   */
  private static restrictedPool: string[] = [];

  /**
   * Issue #3797: optional output-neuron squash pin. When set to a canonical
   * name, every **output** neuron keeps that squash: mutation skips them and
   * any other squash rewrite resolves back to the pin. `null` (the default)
   * keeps today's behaviour — output squashes evolve like hidden ones.
   * Hidden neurons are never affected by the pin.
   */
  private static fixedOutputSquash: string | null = null;

  /**
   * Issue #3796: optional soft-bias weights, canonical name → relative weight,
   * plus the optional {@link SQUASH_WEIGHT_WILDCARD} entry. `null` means no
   * weighting (uniform draw from the mutation-weighted pool).
   */
  private static squashWeights: Map<string, number> | null = null;

  /**
   * Issue #3796: the selectable names and their weights, derived from
   * {@link squashWeights} and {@link allowedSquashes}. `weightedTotal` is `0`
   * when no weighting is active, which is what `pickRandomSquash` tests.
   */
  private static weightedNames: string[] = [];
  private static weightedWeights: number[] = [];
  private static weightedTotal = 0;

  public static register(
    activation: AbstractActivationInterface,
    options: ActivationOptions,
  ): void {
    assert(!Activations.MAP.has(activation.getName()));

    for (let i = 0; i < activation.mutationProbability; i++) {
      Activations.WEIGHTED_POOL.push(activation.getName());
    }

    Activations.MAP.set(activation.getName(), activation);
    if (options.aliases) {
      for (const alias of options.aliases) {
        Activations.MAP.set(alias, activation);
      }
    }
  }

  public static list(): AbstractActivationInterface[] {
    return Array.from(Activations.MAP.values());
  }

  static find(
    name: string,
  ): AbstractActivationInterface {
    const activation = this.MAP.get(name);
    if (activation === undefined) {
      throw new ActivationError(
        `Unknown activation: ${name}`,
        "UNKNOWN_ACTIVATION",
        name,
        0,
      );
    }
    return activation as AbstractActivationInterface;
  }

  public static pickRandomSquash(exclude?: string): string {
    // Issue #3796: a weights map wins — it already composes the allow-list.
    if (Activations.weightedTotal > 0) {
      return Activations.pickWeightedSquash(exclude);
    }
    // Issue #3263: draw from the restricted pool when a squash budget is
    // active, otherwise from the full mutation-weighted pool.
    const base = Activations.allowedSquashes !== null
      ? Activations.restrictedPool
      : Activations.WEIGHTED_POOL;
    let pool = exclude ? base.filter((name) => name !== exclude) : base;
    // Excluding the only allowed squash would empty the pool; fall back to the
    // unfiltered base so we always return an allowed squash (fail loud would
    // be wrong here — the caller simply gets no-change, matching legacy).
    if (pool.length === 0) pool = base;
    const index = Math.floor(getRandomNumberGenerator().random() * pool.length);
    return pool[index];
  }

  /**
   * Issue #3263: restrict squash selection to an allow-list ("squash budget").
   *
   * Each name is resolved through {@link find} (canonicalising aliases and
   * throwing {@link ActivationError} for unknown names), so an invalid budget
   * fails loud at configuration time rather than silently degrading. Passing
   * `null` or an empty array clears the restriction and restores the free mix.
   *
   * The restricted pool preserves each activation's relative mutation weight
   * where possible; if every allowed activation has a mutation weight of zero
   * (e.g. SOFTMAX), the pool falls back to a uniform draw over the allowed
   * names so it is never empty.
   *
   * Any active soft-bias weights (Issue #3796) are kept and re-applied within
   * the new allow-list.
   */
  public static setAllowedSquashes(names: readonly string[] | null): void {
    Activations.applyBudget(
      Activations.canonicaliseAllowed(names),
      Activations.squashWeights,
    );
  }

  /**
   * Issue #3796: apply a soft-bias weights map ("squash weights").
   *
   * Keys are squash names (canonical or alias) plus the optional
   * {@link SQUASH_WEIGHT_WILDCARD} entry, values are relative weights;
   * {@link pickRandomSquash} then samples proportionally to them. A weight of
   * `0` excludes a squash, and the wildcard supplies the weight for every
   * squash the map does not name — so a caller can strongly prefer a few
   * activations without hard-excluding the rest. The wildcard only covers
   * squashes evolution may normally introduce (`mutationProbability > 0`);
   * naming a squash explicitly opts it in regardless.
   *
   * Passing `null` or an empty map clears the weighting and restores the
   * uniform draw. Weights compose with {@link setAllowedSquashes}: the
   * allow-list remains a hard boundary and the weights apply within it.
   *
   * Fails loud (Issue #3234) on an unknown name, a weight that is not a finite
   * number `>= 0`, two aliases of the same squash carrying different weights,
   * or a map that leaves nothing selectable. Nothing is applied when it throws.
   */
  public static setSquashWeights(
    weights: Readonly<Record<string, number>> | null | undefined,
  ): void {
    Activations.applyBudget(
      Activations.allowedSquashes,
      Activations.canonicaliseWeights(weights),
    );
  }

  /**
   * Issue #3796: apply both squash-budget levers in one atomic step, so a
   * fresh configuration never inherits the previous run's weights or
   * allow-list. Validation of both arguments completes before any state
   * changes; nothing is applied when it throws.
   */
  public static setSquashBudget(
    allowedSquashes: readonly string[] | null,
    squashWeights: Readonly<Record<string, number>> | null | undefined,
  ): void {
    Activations.applyBudget(
      Activations.canonicaliseAllowed(allowedSquashes),
      Activations.canonicaliseWeights(squashWeights),
    );
  }

  /**
   * Issue #3796: the active soft-bias weights (canonical names plus the
   * optional `"*"` wildcard), or `null` when no weighting is set.
   */
  public static getSquashWeights(): ReadonlyMap<string, number> | null {
    return Activations.squashWeights;
  }

  /** Resolve an allow-list to canonical names; `null` means no restriction. */
  private static canonicaliseAllowed(
    names: readonly string[] | null,
  ): Set<string> | null {
    if (!names || names.length === 0) return null;
    const canonical = new Set<string>();
    for (const name of names) {
      // Throws ActivationError for unknown names (fail loud, Issue #3234).
      canonical.add(Activations.find(name).getName());
    }
    return canonical;
  }

  /**
   * Issue #3796: resolve a weights map to canonical names, validating every
   * weight. `null` (no weighting) for an absent or empty map.
   */
  private static canonicaliseWeights(
    weights: Readonly<Record<string, number>> | null | undefined,
  ): Map<string, number> | null {
    const entries = weights ? Object.entries(weights) : [];
    if (entries.length === 0) return null;

    const canonical = new Map<string, number>();
    for (const [rawName, rawWeight] of entries) {
      const name = rawName.trim();
      if (name.length === 0) {
        throw new ValidationError(
          "Squash weight names must be non-empty strings",
          "OTHER",
        );
      }
      if (typeof rawWeight !== "number" || !Number.isFinite(rawWeight)) {
        throw new ValidationError(
          `Squash weight for "${name}" must be a finite number, got: ${
            JSON.stringify(rawWeight)
          }`,
          "OTHER",
        );
      }
      if (rawWeight < 0) {
        throw new ValidationError(
          `Squash weight for "${name}" must be >= 0, got: ${rawWeight}`,
          "OTHER",
        );
      }

      // The wildcard is a reserved key, not an activation name. Every other
      // key resolves through `find`, which throws an ActivationError for an
      // unknown name (fail loud, Issue #3234).
      const key = name === Activations.SQUASH_WEIGHT_WILDCARD
        ? Activations.SQUASH_WEIGHT_WILDCARD
        : Activations.find(name).getName();

      const existing = canonical.get(key);
      if (existing !== undefined && existing !== rawWeight) {
        throw new ValidationError(
          `Conflicting squash weights for "${key}": ${existing} and ${rawWeight}`,
          "OTHER",
        );
      }
      canonical.set(key, rawWeight);
    }
    return canonical;
  }

  /**
   * Derive every selection pool from the two levers and install them. The
   * derivation runs first so a rejected budget leaves the previous one intact.
   */
  private static applyBudget(
    allowed: Set<string> | null,
    weights: Map<string, number> | null,
  ): void {
    const selection = Activations.buildWeightedSelection(allowed, weights);

    if (allowed === null) {
      Activations.restrictedPool = [];
    } else {
      const weighted = Activations.WEIGHTED_POOL.filter((n) => allowed.has(n));
      Activations.restrictedPool = weighted.length > 0
        ? weighted
        : Array.from(allowed);
    }
    Activations.allowedSquashes = allowed;
    Activations.squashWeights = weights;
    Activations.weightedNames = selection.names;
    Activations.weightedWeights = selection.weights;
    Activations.weightedTotal = selection.total;
  }

  /**
   * Issue #3796: proportional draw over {@link weightedNames}. `exclude` is
   * skipped unless it is the only selectable squash, matching the legacy
   * no-change behaviour of the uniform path.
   */
  private static pickWeightedSquash(exclude?: string): string {
    const names = Activations.weightedNames;
    const weights = Activations.weightedWeights;
    let total = Activations.weightedTotal;

    let skip = -1;
    if (exclude) {
      const activation = Activations.MAP.get(exclude);
      const canonical = activation ? activation.getName() : exclude;
      const index = names.indexOf(canonical);
      if (index >= 0 && weights[index] < total) {
        skip = index;
        total -= weights[index];
      }
    }

    const target = getRandomNumberGenerator().random() * total;
    let cumulative = 0;
    let last = names[0];
    for (let i = 0; i < names.length; i++) {
      if (i === skip) continue;
      cumulative += weights[i];
      last = names[i];
      if (target < cumulative) return names[i];
    }
    // Floating-point rounding only; `last` is the final selectable name.
    return last;
  }

  /**
   * Issue #3796: derive the weighted selection from a weights map and an
   * optional allow-list. Returns an empty selection when no weights are set.
   * Throws when the combination leaves nothing selectable.
   */
  private static buildWeightedSelection(
    allowed: ReadonlySet<string> | null,
    weights: ReadonlyMap<string, number> | null,
  ): { names: string[]; weights: number[]; total: number } {
    if (weights === null) return { names: [], weights: [], total: 0 };

    const wildcard = weights.get(Activations.SQUASH_WEIGHT_WILDCARD);

    // Candidates: every explicitly weighted squash, plus — when a wildcard is
    // given — every squash evolution may normally introduce. Zero-mutation
    // activations (deprecated, SOFTMAX) are only reachable by naming them.
    const candidates = new Set<string>();
    for (const name of weights.keys()) {
      if (name !== Activations.SQUASH_WEIGHT_WILDCARD) candidates.add(name);
    }
    if (wildcard !== undefined && wildcard > 0) {
      for (const name of Activations.WEIGHTED_POOL) candidates.add(name);
    }

    const names: string[] = [];
    const values: number[] = [];
    let total = 0;
    for (const name of candidates) {
      if (allowed !== null && !allowed.has(name)) continue;
      const weight = weights.get(name) ?? wildcard ?? 0;
      if (weight <= 0) continue;
      names.push(name);
      values.push(weight);
      total += weight;
    }

    if (total <= 0) {
      throw new ValidationError(
        allowed === null
          ? "Squash weights exclude every activation — nothing is selectable"
          : "Squash weights exclude every activation in allowedSquashes — nothing is selectable",
        "OTHER",
      );
    }

    return { names, weights: values, total };
  }

  /**
   * Issue #3263: the active squash allow-list of canonical names, or `null`
   * when no budget is set.
   */
  public static getAllowedSquashes(): ReadonlySet<string> | null {
    return Activations.allowedSquashes;
  }

  /**
   * Issue #3263: whether `name` (canonical or alias) is permitted under the
   * active squash budget. Always `true` when no budget is set.
   *
   * Issue #3796: a squash whose effective weight is `0` is excluded too, so
   * this answers "can selection ever return this squash?" under either lever.
   */
  public static isSquashAllowed(name: string): boolean {
    const canonical = Activations.canonicalName(name);
    if (
      Activations.allowedSquashes !== null &&
      !Activations.allowedSquashes.has(canonical)
    ) {
      return false;
    }
    if (Activations.weightedTotal > 0) {
      return Activations.weightedNames.includes(canonical);
    }
    return true;
  }

  /**
   * Issue #3797: pin the squash of every output neuron.
   *
   * The name is resolved through {@link find}, canonicalising aliases and
   * throwing {@link ActivationError} for unknown names, so an invalid pin
   * fails loud at configuration time (Issue #3234). Passing `null`,
   * `undefined`, or a blank string clears the pin and restores today's
   * behaviour.
   */
  public static setFixedOutputSquash(name: string | null | undefined): void {
    const trimmed = name?.trim();
    if (!trimmed) {
      Activations.fixedOutputSquash = null;
      return;
    }
    // Throws ActivationError for unknown names (fail loud, Issue #3234).
    Activations.fixedOutputSquash = Activations.find(trimmed).getName();
  }

  /**
   * Issue #3797: the canonical squash every output neuron is pinned to, or
   * `null` when output squashes are free to evolve.
   */
  public static getFixedOutputSquash(): string | null {
    return Activations.fixedOutputSquash;
  }

  /**
   * Issue #3797: whether `name` (canonical or alias) already satisfies the
   * active output-squash pin. Always `true` when no pin is set, and `false`
   * for a missing squash while a pin is active.
   */
  public static matchesFixedOutputSquash(name: string | undefined): boolean {
    if (Activations.fixedOutputSquash === null) return true;
    if (name === undefined) return false;
    return Activations.canonicalName(name) === Activations.fixedOutputSquash;
  }

  /** Resolve an alias to its canonical name, leaving unknown names as-is. */
  private static canonicalName(name: string): string {
    const activation = Activations.MAP.get(name);
    return activation ? activation.getName() : name;
  }

  /**
   * Issue #3263: reset the squash budget to the unrestricted default. Used by
   * the test preload so parallel workers start from a known baseline, mirroring
   * `resetGlobalRandomNumberGeneratorForTesting`.
   */
  public static resetAllowedSquashesForTesting(): void {
    Activations.allowedSquashes = null;
    Activations.restrictedPool = [];
    // Issue #3796: the soft-bias weights are part of the same global budget.
    Activations.squashWeights = null;
    Activations.weightedNames = [];
    Activations.weightedWeights = [];
    Activations.weightedTotal = 0;
  }

  /**
   * Issue #3797: clear the output-squash pin. Used by the test preload so
   * parallel workers start from a known baseline, mirroring
   * {@link resetAllowedSquashesForTesting}.
   */
  public static resetFixedOutputSquashForTesting(): void {
    Activations.fixedOutputSquash = null;
  }
}

const activationClasses = [
  ABSOLUTE,
  ArcTan,

  BENT_IDENTITY,
  BIPOLAR,
  BIPOLAR_SIGMOID,

  COMPLEMENT,
  Cosine,
  Cube,

  ELU,
  Exponential,

  GAUSSIAN,
  GELU,

  HARD_TANH,

  // best-practice-ignore: BP-91862f495db6 — deliberate; see import above.
  HYPOT,
  // best-practice-ignore: BP-6b1e9a008759 — deliberate; see import above.
  HYPOTv2,

  IDENTITY,
  IF,

  ISRU,

  LeakyReLU,
  LOGISTIC,
  LogSigmoid,

  MAXIMUM,
  // best-practice-ignore: BP-619a32c95d3a — deliberate; see import above.
  MEAN,
  MINIMUM,
  Mish,

  ReLU,

  ReLU6,

  SELU,
  SINE,

  SOFTMAX,
  SOFTSIGN,
  Softplus,
  SQRT,
  SQUARE,
  StdInverse,
  STEP,
  Swish,

  TAN,
  TANH,
];

activationClasses.forEach((activationClass) => {
  const activation = new activationClass();
  let options: ActivationOptions;
  switch (activation.getName()) {
    case HARD_TANH.NAME:
      options = { aliases: ["CLIPPED"] };
      break;
    case ReLU.NAME:
      options = { aliases: ["RELU"] };
      break;
    case COMPLEMENT.NAME:
      options = { aliases: ["INVERSE"] };
      break;
    case SINE.NAME:
      options = { aliases: ["SINUSOID"] };
      break;
    default:
      options = {};
      break;
  }
  Activations.register(activation, options);
});

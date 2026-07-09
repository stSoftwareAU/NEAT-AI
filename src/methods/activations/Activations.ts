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
import { HYPOT } from "@deprecated/HYPOT.ts";
import { HYPOTv2 } from "@deprecated/HYPOTv2.ts";
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
   */
  public static setAllowedSquashes(names: readonly string[] | null): void {
    if (!names || names.length === 0) {
      Activations.allowedSquashes = null;
      Activations.restrictedPool = [];
      return;
    }

    const canonical = new Set<string>();
    for (const name of names) {
      // Throws ActivationError for unknown names (fail loud, Issue #3234).
      canonical.add(Activations.find(name).getName());
    }

    const weighted = Activations.WEIGHTED_POOL.filter((n) => canonical.has(n));
    Activations.restrictedPool = weighted.length > 0
      ? weighted
      : Array.from(canonical);
    Activations.allowedSquashes = canonical;
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
   */
  public static isSquashAllowed(name: string): boolean {
    if (Activations.allowedSquashes === null) return true;
    const activation = Activations.MAP.get(name);
    const canonical = activation ? activation.getName() : name;
    return Activations.allowedSquashes.has(canonical);
  }

  /**
   * Issue #3263: reset the squash budget to the unrestricted default. Used by
   * the test preload so parallel workers start from a known baseline, mirroring
   * `resetGlobalRandomNumberGeneratorForTesting`.
   */
  public static resetAllowedSquashesForTesting(): void {
    Activations.allowedSquashes = null;
    Activations.restrictedPool = [];
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

  HYPOT,
  HYPOTv2,

  IDENTITY,
  IF,

  ISRU,

  LeakyReLU,
  LOGISTIC,
  LogSigmoid,

  MAXIMUM,
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

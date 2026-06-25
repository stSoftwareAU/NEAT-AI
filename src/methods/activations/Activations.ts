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
    const pool = exclude
      ? Activations.WEIGHTED_POOL.filter((name) => name !== exclude)
      : Activations.WEIGHTED_POOL;
    const index = Math.floor(getRandomNumberGenerator().random() * pool.length);
    return pool[index];
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

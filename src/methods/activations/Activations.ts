import { assert } from "@std/assert/assert";
import { MEAN } from "../../deprecated/MEAN.ts";
import type { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { HYPOT } from "../../deprecated/HYPOT.ts";
import { HYPOTv2 } from "../../deprecated/HYPOTv2.ts";
import { IF } from "./aggregate/IF.ts";
import { MAXIMUM } from "./aggregate/MAXIMUM.ts";
import { MINIMUM } from "./aggregate/MINIMUM.ts";
import { ABSOLUTE } from "./types/ABSOLUTE.ts";
import { ArcTan } from "./types/ArcTan.ts";
import { BENT_IDENTITY } from "./types/BENT_IDENTITY.ts";
import { BIPOLAR } from "./types/BIPOLAR.ts";
import { BIPOLAR_SIGMOID } from "./types/BIPOLAR_SIGMOID.ts";
import { COMPLEMENT } from "./types/COMPLEMENT.ts";
import { Cosine } from "./types/Cosine.ts";
import { Cube } from "./types/Cube.ts";
import { ELU } from "./types/ELU.ts";
import { Exponential } from "./types/Exponential.ts";
import { GAUSSIAN } from "./types/GAUSSIAN.ts";
import { GELU } from "./types/GELU.ts";
import { HARD_TANH } from "./types/HARD_TANH.ts";
import { IDENTITY } from "./types/IDENTITY.ts";
import { ISRU } from "./types/ISRU.ts";
import { LOGISTIC } from "./types/LOGISTIC.ts";
import { LeakyReLU } from "./types/LeakyReLU.ts";
import { LogSigmoid } from "./types/LogSigmoid.ts";
import { Mish } from "./types/Mish.ts";
import { ReLU } from "./types/ReLU.ts";
import { ReLU6 } from "./types/ReLU6.ts";
import { SELU } from "./types/SELU.ts";
import { SINE } from "./types/SINE.ts";
import { SOFTSIGN } from "./types/SOFTSIGN.ts";
import { SQRT } from "./types/SQRT.ts";
import { SQUARE } from "./types/SQUARE.ts";
import { STEP } from "./types/STEP.ts";
import { Softplus } from "./types/Softplus.ts";
import { StdInverse } from "./types/StdInverse.ts";
import { Swish } from "./types/Swish.ts";
import { TAN } from "./types/TAN.ts";
import { TANH } from "./types/TANH.ts";

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
      throw new Error(`Unknown activation: ${name}`);
    }
    return activation as AbstractActivationInterface;
  }

  public static pickRandomSquash(exclude?: string): string {
    const pool = exclude
      ? Activations.WEIGHTED_POOL.filter((name) => name !== exclude)
      : Activations.WEIGHTED_POOL;
    const index = Math.floor(Math.random() * pool.length);
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

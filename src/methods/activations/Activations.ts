import { MEAN } from "../../deprecated/MEAN.ts";
import type { AbstractActivationInterface } from "./AbstractActivationInterface.ts";
import { HYPOT } from "./aggregate/HYPOT.ts";
import { HYPOTv2 } from "./aggregate/HYPOTv2.ts";
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
    console.info(`Registering activation: ${activation.getName()}`);
    if (!Activations.MAP.has(activation.getName())) {
      for (let i = 0; i < activation.mutationProbability; i++) {
        Activations.WEIGHTED_POOL.push(activation.getName());
      }
    }

    Activations.MAP.set(activation.getName(), activation);
    if (options.aliases) {
      for (const alias of options.aliases) {
        console.info(`Registering alias: ${alias} for ${activation.getName()}`);
        Activations.MAP.set(alias, activation);
      }
    }
  }

  public static list(): AbstractActivationInterface[] {
    return Array.from(Activations.MAP.values());
  }

  // private static readonly MAP: Map<string, AbstractActivationInterface> =
  //   new Map<string, AbstractActivationInterface>([
  //     [ABSOLUTE.NAME, new ABSOLUTE()],
  //     [ArcTan.NAME, new ArcTan()],

  //     [BENT_IDENTITY.NAME, new BENT_IDENTITY()],
  //     [BIPOLAR.NAME, new BIPOLAR()],
  //     [BIPOLAR_SIGMOID.NAME, new BIPOLAR_SIGMOID()],

  //     [COMPLEMENT.NAME, new COMPLEMENT()],
  //     [Cosine.NAME, new Cosine()],
  //     [Cube.NAME, new Cube()],

  //     [ELU.NAME, new ELU()],
  //     [Exponential.NAME, new Exponential()],

  //     [GAUSSIAN.NAME, new GAUSSIAN()],
  //     [GELU.NAME, new GELU()],

  //     [HARD_TANH.NAME, new HARD_TANH()],
  //     ["CLIPPED", new HARD_TANH()],

  //     [HYPOT.NAME, new HYPOT()],
  //     [HYPOTv2.NAME, new HYPOTv2()],

  //     [IDENTITY.NAME, new IDENTITY()],
  //     [IF.NAME, new IF()],
  //     ["INVERSE", new COMPLEMENT()],
  //     [ISRU.NAME, new ISRU()],

  //     [LeakyReLU.NAME, new LeakyReLU()],
  //     [LOGISTIC.NAME, new LOGISTIC()],
  //     [LogSigmoid.NAME, new LogSigmoid()],

  //     [MAXIMUM.NAME, new MAXIMUM()],
  //     [MEAN.NAME, new MEAN()],
  //     [MINIMUM.NAME, new MINIMUM()],
  //     [Mish.NAME, new Mish()],

  //     [ReLU.NAME, new ReLU()],
  //     ["RELU", new ReLU()],
  //     [ReLU6.NAME, new ReLU6()],

  //     [SELU.NAME, new SELU()],
  //     [SINE.NAME, new SINE()],
  //     ["SINUSOID", new SINE()],
  //     [SOFTSIGN.NAME, new SOFTSIGN()],
  //     [Softplus.NAME, new Softplus()],
  //     [SQRT.NAME, new SQRT()],
  //     [SQUARE.NAME, new SQUARE()],
  //     [StdInverse.NAME, new StdInverse()],
  //     [STEP.NAME, new STEP()],
  //     [Swish.NAME, new Swish()],

  //     [TAN.NAME, new TAN()],
  //     [TANH.NAME, new TANH()],
  //   ]);

  // public static readonly NAMES = [...Activations.MAP.keys()].filter(
  //   (key) =>
  //     !["INVERSE", "SINUSOID", MEAN.NAME, "CLIPPED", "RELU"].includes(key),
  // );

  static find(
    name: string,
  ): AbstractActivationInterface {
    const activation = this.MAP.get(name);
    if (activation === undefined) {
      throw new Error(`Unknown activation: ${name}`);
    }
    return activation as AbstractActivationInterface;
  }

  // private static readonly WEIGHTED_POOL: string[] = (() => {
  //   const weighted: [string, number][] = [
  //     [Mish.NAME, 10], // 🔼 Highest priority
  //     [Swish.NAME, 9], // 🔼 Very strong performance
  //     [GELU.NAME, 8], // 🔼 Popular in Transformers
  //     [ELU.NAME, 7], // 🔼 Smooth and stable
  //     [LeakyReLU.NAME, 6], // ✅ Safe fallback to avoid dead neurons
  //     [ReLU.NAME, 5], // ⚠️ Still common, but has issues

  //     // Stable legacy + secondary options
  //     [TANH.NAME, 5],
  //     [LOGISTIC.NAME, 4],
  //     [Softplus.NAME, 4],
  //     [SELU.NAME, 4],
  //     [HARD_TANH.NAME, 3],
  //     [BENT_IDENTITY.NAME, 3],
  //     [SOFTSIGN.NAME, 3],
  //     [ArcTan.NAME, 3],
  //     [ReLU6.NAME, 3],

  //     // Niche/specialized or legacy functions
  //     [SINE.NAME, 2],
  //     [ABSOLUTE.NAME, 2],
  //     [Cosine.NAME, 2],
  //     [Cube.NAME, 2],
  //     [Exponential.NAME, 2],
  //     [GAUSSIAN.NAME, 2],
  //     [ISRU.NAME, 2],
  //     [LogSigmoid.NAME, 2],
  //     [TAN.NAME, 2],
  //     [STEP.NAME, 2],

  //     // Experimental or rarely beneficial
  //     [StdInverse.NAME, 1],
  //     [IDENTITY.NAME, 1],
  //     [BIPOLAR_SIGMOID.NAME, 1],
  //     [COMPLEMENT.NAME, 1],
  //     [IF.NAME, 1],
  //     [HYPOT.NAME, 0], // ⚠️ very non standard and back propagation is very hard. Evolve away from HYPOT.
  //     [HYPOTv2.NAME, 0], // ⚠️ very non standard and back propagation is very hard. Evolve away from HYPOTv2.
  //     [MAXIMUM.NAME, 1],
  //     [MINIMUM.NAME, 1],
  //     [BIPOLAR.NAME, 1],
  //     [SQUARE.NAME, 1],
  //     [SQRT.NAME, 1],
  //   ];
  //   const result: string[] = [];
  //   for (const [name, weight] of weighted) {
  //     for (let i = 0; i < weight; i++) result.push(name);
  //   }
  //   return result;
  // })();

  public static pickRandomWeighted(exclude?: string): string {
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
  // "CLIPPED", new HARD_TANH()],

  HYPOT,
  HYPOTv2,

  IDENTITY,
  IF,
  // ["INVERSE", new COMPLEMENT()],
  ISRU,

  LeakyReLU,
  LOGISTIC,
  LogSigmoid,

  MAXIMUM,
  MEAN,
  MINIMUM,
  Mish,

  ReLU,
  // ["RELU", new ReLU()],
  ReLU6,

  SELU,
  SINE,
  // ["SINUSOID", new SINE()],
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

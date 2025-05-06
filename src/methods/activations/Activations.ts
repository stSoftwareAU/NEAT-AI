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
import { STEP } from "./types/STEP.ts";
import { Softplus } from "./types/Softplus.ts";
import { StdInverse } from "./types/StdInverse.ts";
import { Swish } from "./types/Swish.ts";
import { TAN } from "./types/TAN.ts";
import { TANH } from "./types/TANH.ts";

/**
 * https://en.wikipedia.org/wiki/Activation_function
 * https://stats.stackexchange.com/questions/115258/comprehensive-list-of-activation-functions-in-neural-networks-with-pros-cons
 */
export class Activations {
  private static readonly MAP: Map<string, AbstractActivationInterface> =
    new Map<string, AbstractActivationInterface>([
      [ABSOLUTE.NAME, new ABSOLUTE()],
      [ArcTan.NAME, new ArcTan()],

      [BENT_IDENTITY.NAME, new BENT_IDENTITY()],
      [BIPOLAR.NAME, new BIPOLAR()],
      [BIPOLAR_SIGMOID.NAME, new BIPOLAR_SIGMOID()],

      [COMPLEMENT.NAME, new COMPLEMENT()],
      [Cosine.NAME, new Cosine()],
      [Cube.NAME, new Cube()],

      [ELU.NAME, new ELU()],
      [Exponential.NAME, new Exponential()],

      [GAUSSIAN.NAME, new GAUSSIAN()],
      [GELU.NAME, new GELU()],

      [HARD_TANH.NAME, new HARD_TANH()],
      ["CLIPPED", new HARD_TANH()],

      [HYPOT.NAME, new HYPOT()],
      [HYPOTv2.NAME, new HYPOTv2()],

      [IDENTITY.NAME, new IDENTITY()],
      [IF.NAME, new IF()],
      ["INVERSE", new COMPLEMENT()],
      [ISRU.NAME, new ISRU()],

      [LeakyReLU.NAME, new LeakyReLU()],
      [LOGISTIC.NAME, new LOGISTIC()],
      [LogSigmoid.NAME, new LogSigmoid()],

      [MAXIMUM.NAME, new MAXIMUM()],
      [MEAN.NAME, new MEAN()],
      [MINIMUM.NAME, new MINIMUM()],
      [Mish.NAME, new Mish()],

      [ReLU.NAME, new ReLU()],
      ["RELU", new ReLU()],
      [ReLU6.NAME, new ReLU6()],

      [SELU.NAME, new SELU()],
      [SINE.NAME, new SINE()],
      ["SINUSOID", new SINE()],
      [SOFTSIGN.NAME, new SOFTSIGN()],
      [Softplus.NAME, new Softplus()],
      [StdInverse.NAME, new StdInverse()],
      [STEP.NAME, new STEP()],
      [Swish.NAME, new Swish()],

      [TAN.NAME, new TAN()],
      [TANH.NAME, new TANH()],
    ]);

  public static readonly NAMES = [...Activations.MAP.keys()].filter(
    (key) =>
      !["INVERSE", "SINUSOID", MEAN.NAME, "CLIPPED", "RELU"].includes(key),
  );

  static find(
    name: string,
  ): AbstractActivationInterface {
    const activation = this.MAP.get(name);
    if (activation === undefined) {
      throw new Error(`Unknown activation: ${name}`);
    }
    return activation as AbstractActivationInterface;
  }

  private static readonly WEIGHTED_POOL: string[] = (() => {
    const weighted: [string, number][] = [
      [LeakyReLU.NAME, 10],
      [GELU.NAME, 9],
      [Swish.NAME, 8],
      [TANH.NAME, 8],
      [LOGISTIC.NAME, 7],
      [Softplus.NAME, 7],
      [Mish.NAME, 6],
      [ELU.NAME, 6],
      [SELU.NAME, 5],
      [HARD_TANH.NAME, 5],
      [ReLU.NAME, 5],
      [BENT_IDENTITY.NAME, 4],
      [SOFTSIGN.NAME, 4],
      [ArcTan.NAME, 4],
      [ReLU6.NAME, 4],
      [SINE.NAME, 3],
      [ABSOLUTE.NAME, 2],
      [Cosine.NAME, 2],
      [Cube.NAME, 2],
      [Exponential.NAME, 2],
      [GAUSSIAN.NAME, 2],
      [ISRU.NAME, 2],
      [LogSigmoid.NAME, 2],
      [STEP.NAME, 2],
      [TAN.NAME, 2],
      [COMPLEMENT.NAME, 0],
      [StdInverse.NAME, 1],
      [IDENTITY.NAME, 1],
      [IF.NAME, 0],
      [HYPOT.NAME, 0],
      [HYPOTv2.NAME, 0],
      [MAXIMUM.NAME, 0],
      [MINIMUM.NAME, 0],
      [BIPOLAR.NAME, 0],
      [BIPOLAR_SIGMOID.NAME, 1],
    ];
    const result: string[] = [];
    for (const [name, weight] of weighted) {
      for (let i = 0; i < weight; i++) result.push(name);
    }
    return result;
  })();

  public static pickRandomWeighted(exclude?: string): string {
    const pool = exclude
      ? Activations.WEIGHTED_POOL.filter((name) => name !== exclude)
      : Activations.WEIGHTED_POOL;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
  }
}

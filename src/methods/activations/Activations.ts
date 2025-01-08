import { HYPOT } from "./aggregate/HYPOT.ts";
import { HYPOTv2 } from "./aggregate/HYPOTv2.ts";
import { IF } from "./aggregate/IF.ts";
import { MAXIMUM } from "./aggregate/MAXIMUM.ts";
import { MEAN } from "../../legacy/MEAN.ts";
import { MINIMUM } from "./aggregate/MINIMUM.ts";
import { ABSOLUTE } from "./types/ABSOLUTE.ts";
import { ArcTan } from "./types/ArcTan.ts";
import { BENT_IDENTITY } from "./types/BENT_IDENTITY.ts";
import { BIPOLAR } from "./types/BIPOLAR.ts";
import { BIPOLAR_SIGMOID } from "./types/BIPOLAR_SIGMOID.ts";
import { CLIPPED } from "./types/CLIPPED.ts";
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
import { RELU } from "./types/RELU.ts";
import { ReLU6 } from "./types/ReLU6.ts";
import { SELU } from "./types/SELU.ts";
import { SINE } from "./types/SINE.ts";
import { SOFTSIGN } from "./types/SOFTSIGN.ts";
import { STEP } from "./types/STEP.ts";
import { Softplus } from "./types/Softplus.ts";
import { StdInverse } from "./types/StdInverse.ts";
import { Swish } from "./types/Swish.ts";
import { TANH } from "./types/TANH.ts";

/**
 * https://en.wikipedia.org/wiki/Activation_function
 * https://stats.stackexchange.com/questions/115258/comprehensive-list-of-activation-functions-in-neural-networks-with-pros-cons
 */
export class Activations {
  private static MAP = {
    [ABSOLUTE.NAME]: new ABSOLUTE(),
    [ArcTan.NAME]: new ArcTan(),

    [BENT_IDENTITY.NAME]: new BENT_IDENTITY(),
    [BIPOLAR.NAME]: new BIPOLAR(),
    [BIPOLAR_SIGMOID.NAME]: new BIPOLAR_SIGMOID(),

    [CLIPPED.NAME]: new CLIPPED(),
    [COMPLEMENT.NAME]: new COMPLEMENT(),
    [Cosine.NAME]: new Cosine(),
    [Cube.NAME]: new Cube(),

    [ELU.NAME]: new ELU(),
    [Exponential.NAME]: new Exponential(),

    [GAUSSIAN.NAME]: new GAUSSIAN(),
    [GELU.NAME]: new GELU(),

    [HARD_TANH.NAME]: new HARD_TANH(),
    [HYPOT.NAME]: new HYPOT(),
    [HYPOTv2.NAME]: new HYPOTv2(),

    [IDENTITY.NAME]: new IDENTITY(),
    [IF.NAME]: new IF(),
    ["INVERSE"]: new COMPLEMENT(),
    [ISRU.NAME]: new ISRU(),

    [LeakyReLU.NAME]: new LeakyReLU(),
    [LOGISTIC.NAME]: new LOGISTIC(),
    [LogSigmoid.NAME]: new LogSigmoid(),

    [MAXIMUM.NAME]: new MAXIMUM(),
    [MEAN.NAME]: new MEAN(),
    [MINIMUM.NAME]: new MINIMUM(),
    [Mish.NAME]: new Mish(),

    [RELU.NAME]: new RELU(),
    [ReLU6.NAME]: new ReLU6(),

    [SELU.NAME]: new SELU(),
    [SINE.NAME]: new SINE(),
    ["SINUSOID"]: new SINE(),
    [SOFTSIGN.NAME]: new SOFTSIGN(),
    [Softplus.NAME]: new Softplus(),
    [StdInverse.NAME]: new StdInverse(),
    [STEP.NAME]: new STEP(),
    [Swish.NAME]: new Swish(),

    [TANH.NAME]: new TANH(),
  };

  static readonly NAMES = Object.keys(Activations.MAP)
    .filter((key) => !["INVERSE", "SINUSOID", MEAN.NAME].includes(key));

  static find(name: string) {
    const activation = this.MAP[name];
    if (!activation) {
      throw new Error("Unknown activation: " + name);
    }
    return activation;
  }
}

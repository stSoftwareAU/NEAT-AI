import { HYPOT } from "./aggregate/HYPOT.ts";
import { IF } from "./aggregate/IF.ts";
import { MAXIMUM } from "./aggregate/MAXIMUM.ts";
import { MEAN } from "./aggregate/MEAN.ts";
import { MINIMUM } from "./aggregate/MINIMUM.ts";
import { ABSOLUTE } from "./types/ABSOLUTE.ts";
import { BENT_IDENTITY } from "./types/BENT_IDENTITY.ts";
import { BIPOLAR } from "./types/BIPOLAR.ts";
import { BIPOLAR_SIGMOID } from "./types/BIPOLAR_SIGMOID.ts";
import { CLIPPED } from "./types/CLIPPED.ts";
import { Cosine } from "./types/Cosine.ts";
import { ELU } from "./types/ELU.ts";
import { Exponential } from "./types/Exponential.ts";
import { GAUSSIAN } from "./types/GAUSSIAN.ts";
import { HARD_TANH } from "./types/HARD_TANH.ts";
import { IDENTITY } from "./types/IDENTITY.ts";
import { INVERSE } from "./types/INVERSE.ts";
import { LOGISTIC } from "./types/LOGISTIC.ts";
import { LeakyReLU } from "./types/LeakyReLU.ts";
import { LogSigmoid } from "./types/LogSigmoid.ts";
import { Mish } from "./types/Mish.ts";
import { RELU } from "./types/RELU.ts";
import { SELU } from "./types/SELU.ts";
import { SINUSOID } from "./types/SINUSOID.ts";
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
    [CLIPPED.NAME]: new CLIPPED(),
    [LOGISTIC.NAME]: new LOGISTIC(),
    [TANH.NAME]: new TANH(),

    [IDENTITY.NAME]: new IDENTITY(),
    [INVERSE.NAME]: new INVERSE(),

    [RELU.NAME]: new RELU(),
    [STEP.NAME]: new STEP(),
    [SELU.NAME]: new SELU(),
    [SOFTSIGN.NAME]: new SOFTSIGN(),
    [SINUSOID.NAME]: new SINUSOID(),
    [GAUSSIAN.NAME]: new GAUSSIAN(),
    [BENT_IDENTITY.NAME]: new BENT_IDENTITY(),
    [BIPOLAR.NAME]: new BIPOLAR(),
    [BIPOLAR_SIGMOID.NAME]: new BIPOLAR_SIGMOID(),
    [HARD_TANH.NAME]: new HARD_TANH(),
    [ABSOLUTE.NAME]: new ABSOLUTE(),

    [MINIMUM.NAME]: new MINIMUM(),

    [MAXIMUM.NAME]: new MAXIMUM(),
    [MEAN.NAME]: new MEAN(),
    [HYPOT.NAME]: new HYPOT(),
    [IF.NAME]: new IF(),

    [LeakyReLU.NAME]: new LeakyReLU(),
    [ELU.NAME]: new ELU(),
    [Softplus.NAME]: new Softplus(),
    [Swish.NAME]: new Swish(),
    [Mish.NAME]: new Mish(),
    [StdInverse.NAME]: new StdInverse(),
    [Cosine.NAME]: new Cosine(),
    [LogSigmoid.NAME]: new LogSigmoid(),
    [Exponential.NAME]: new Exponential(),
  };

  static NAMES = Object.keys(Activations.MAP);

  static find(name: string) {
    const activation = this.MAP[name];
    if (!activation) {
      throw new Error("Unknown activation: " + name);
    }
    return activation;
  }
}

import { Logistic } from "./types/Logistic.ts";
import { TANH } from "./types/TANH.ts";
import { IDENTITY } from "./types/IDENTITY.ts";
import { INVERSE } from "./types/INVERSE.ts";
import { RELU } from "./types/RELU.ts";

import { SELU } from "./types/SELU.ts";
import { STEP } from "./types/STEP.ts";
import { SOFTSIGN } from "./types/SOFTSIGN.ts";
import { SINUSOID } from "./types/SINUSOID.ts";
import { GAUSSIAN } from "./types/GAUSSIAN.ts";
import { BENT_IDENTITY } from "./types/BENT_IDENTITY.ts";
import { BIPOLAR } from "./types/BIPOLAR.ts";

import { BIPOLAR_SIGMOID } from "./types/BIPOLAR_SIGMOID.ts";

import { HARD_TANH } from "./types/HARD_TANH.ts";

import { ABSOLUTE } from "./types/ABSOLUTE.ts";

/**
 * https://en.wikipedia.org/wiki/Activation_function
 * https://stats.stackexchange.com/questions/115258/comprehensive-list-of-activation-functions-in-neural-networks-with-pros-cons
 */
export class Activations {
  static NAMES = [
    Logistic.NAME,
    TANH.NAME,
    IDENTITY.NAME,
    INVERSE.NAME,
    STEP.NAME,
    RELU.NAME,
    SELU.NAME,
    SOFTSIGN.NAME,
    SINUSOID.NAME,
    GAUSSIAN.NAME,
    BENT_IDENTITY.NAME,
    BIPOLAR.NAME,
    BIPOLAR_SIGMOID.NAME,
    HARD_TANH.NAME,
    ABSOLUTE.NAME,
  ];

  private static logistic = new Logistic();
  private static tanh = new TANH();
  private static identity = new IDENTITY();
  private static step = new STEP();
  private static relu = new RELU();
  private static softsign = new SOFTSIGN();
  private static sinusoid = new SINUSOID();
  private static gaussian = new GAUSSIAN();
  private static bentIdentity = new BENT_IDENTITY();
  private static biPolar = new BIPOLAR();
  private static biPolarSigmoid = new BIPOLAR_SIGMOID();
  private static hardTanh = new HARD_TANH();
  private static absolute = new ABSOLUTE();
  private static inverse = new INVERSE();
  private static selu = new SELU();

  static find(name: string) {
    switch (name) {
      case Logistic.NAME:
        return this.logistic;
      case TANH.NAME:
        return this.tanh;
      case IDENTITY.NAME:
        return this.identity;
      case INVERSE.NAME:
        return this.inverse;
      case RELU.NAME:
        return this.relu;
      case SELU.NAME:
        return this.selu;
      case STEP.NAME:
        return this.step;
      case SOFTSIGN.NAME:
        return this.softsign;
      case SINUSOID.NAME:
        return this.sinusoid;
      case GAUSSIAN.NAME:
        return this.gaussian;
      case BENT_IDENTITY.NAME:
        return this.bentIdentity;
      case BIPOLAR.NAME:
        return this.biPolar;
      case BIPOLAR_SIGMOID.NAME:
        return this.biPolarSigmoid;
      case HARD_TANH.NAME:
        return this.hardTanh;
      case ABSOLUTE.NAME:
        return this.absolute;

      default:
        throw "Unknown activation: " + name;
    }
  }
}

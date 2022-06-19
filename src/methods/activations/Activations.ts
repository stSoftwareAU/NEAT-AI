import { Logistic } from "./Logistic.ts";
import { TANH } from "./TANH.ts";
import { IDENTITY } from "./IDENTITY.ts";
import { STEP } from "./STEP.ts";
import { RELU } from "./RELU.ts";
import { SOFTSIGN } from "./SOFTSIGN.ts";
import { SINUSOID } from "./SINUSOID.ts";
import { GAUSSIAN } from "./GAUSSIAN.ts";

export class Activations {
  static NAMES = [
    Logistic.NAME,
    TANH.NAME,
    IDENTITY.NAME,
    STEP.NAME,
    RELU.NAME,
    SOFTSIGN.NAME,
    SINUSOID.NAME,
    GAUSSIAN.NAME,
  ];

  private static logistic = new Logistic();
  private static tanh = new TANH();
  private static identity = new IDENTITY();
  private static step = new STEP();
  private static relu = new RELU();
  private static softsign = new SOFTSIGN();
  private static sinusoid = new SINUSOID();
  private static gaussian = new GAUSSIAN();

  static find(name: string) {
    switch (name) {
      case Logistic.NAME:
        return this.logistic;
      case TANH.NAME:
        return this.tanh;
      case IDENTITY.NAME:
        return this.identity;
      case STEP.NAME:
        return this.step;
      case RELU.NAME:
        return this.relu;
      case SOFTSIGN.NAME:
        return this.softsign;
      case SINUSOID.NAME:
        return this.sinusoid;
      case GAUSSIAN.NAME:
        return this.gaussian;

      default:
        throw "Unknown activation: " + name;
    }
  }
}

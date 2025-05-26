import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { ActivationRange } from "../../../src/propagate/ActivationRange.ts";

/**
 * Replay the exact activation values during backpropagation.
 */
export class ReplaySquash implements ActivationInterface {
  private name: string;
  private source: ActivationInterface;
  constructor(name: string, source: ActivationInterface) {
    // Replace invalid chars with underscore
    let sanitized = name.replace(/[^a-zA-Z0-9_$]/g, "_");

    // If the name starts with a digit, prefix with 'f_'
    if (/^\d/.test(sanitized)) {
      sanitized = "f_" + sanitized;
    }
    this.name = sanitized;
    this.playback = false;
    this.playbackMap = new Map();
    this.range = source.range;
    this.source = source;

    Activations.register(this, {});
  }

  public mutationProbability = 0;

  playback: boolean = false;

  private playbackMap: Map<string, number>;

  public readonly range: ActivationRange;

  getName(): string {
    return this.name;
  }

  squash(x: number): number {
    if (this.playback) {
      const playbackValue = this.playbackMap.get(x.toPrecision(6));
      if (playbackValue !== undefined) {
        console.info(
          `playback value: ${playbackValue} found for ${x.toPrecision(6)}`,
        );
        return playbackValue;
      } else {
        console.info(`No playback value found for ${x.toPrecision(6)}`);
      }
    }

    return this.source.squash(x);
  }

  calculateError(
    _currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number {
    this.playbackMap.set(
      currentValue.toPrecision(6),
      targetActivation,
    );
    console.info(`Record: ${currentValue} -> ${targetActivation}`);
    return 0;
    // const rawError = targetActivation - currentActivation;
    // if (Math.abs(rawError) < ERROR_EPSILON) return 0;

    // const slope = this.derivative(currentValue);
    // return ErrorHelper.calculateClampedError(rawError / slope);
  }
}

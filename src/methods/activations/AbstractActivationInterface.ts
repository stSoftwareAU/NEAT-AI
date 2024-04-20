/** Correct the target activation to a possible activation */
type NormalizeFunction = (targetActivation: number) => number;

export interface AbstractActivationInterface {
  getName(): string;
  range(): { low: number; high: number; normalize?: NormalizeFunction };
}

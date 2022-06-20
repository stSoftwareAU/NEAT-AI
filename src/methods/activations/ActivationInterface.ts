interface SquashAndDeriveResult {
  activation: number;
  derivative: number;
}

export interface ActivationInterface {
  getName(): string;
  squashAndDerive(x: number): SquashAndDeriveResult;
  squash(x: number): number;
}

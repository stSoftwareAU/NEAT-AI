import type { SquasherInterface } from "./SquasherInterface.ts";

export class SquashConstant implements SquasherInterface {
  private readonly bias: number;
  constructor(bias: number) {
    this.bias = bias;
  }

  squash(): number {
    return this.bias;
  }
}

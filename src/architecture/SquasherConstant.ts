import type { SquasherInterface } from "./SquasherInterface.ts";

export class SquasherConstant implements SquasherInterface {
  private readonly bias: number;
  constructor(bias: number) {
    this.bias = bias;
  }

  squashAndTrace(): number {
    return this.bias;
  }

  squash(): number {
    return this.bias;
  }
}

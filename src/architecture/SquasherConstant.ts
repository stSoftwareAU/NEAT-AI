import type { SquasherInterface } from "./SquasherInterface.ts";

export class SquashConstant implements SquasherInterface {
  private constant: number;
  constructor(constant: number) {
    this.constant = constant;
  }

  squash(): number {
    return this.constant;
  }
}

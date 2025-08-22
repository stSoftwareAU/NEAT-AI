interface CostInterface {
  getName(): string;
  calculate(target: Float32Array, output: Float32Array): number;
}

export class SimpleTouchCost implements CostInterface {
  constructor() {
    this.touchFile();
  }

  getName(): string {
    return "SimpleTouchCost";
  }

  calculate(target: Float32Array, output: Float32Array): number {
    this.touchFile();

    // Simple MSE calculation
    let totalError = 0;
    for (let i = 0; i < target.length; i++) {
      const error = target[i] - output[i];
      totalError += error * error;
    }

    return totalError / target.length;
  }

  private touchFile(): void {
    try {
      const touchFile = ".test/customCost/.touched";
      Deno.writeTextFileSync(touchFile, new Date().toISOString());
    } catch (error) {
      console.log("Touch failed:", error);
    }
  }
}

export default SimpleTouchCost;

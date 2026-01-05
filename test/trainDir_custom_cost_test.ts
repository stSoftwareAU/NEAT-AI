import { assert, assertAlmostEquals } from "@std/assert";
import { trainDir } from "../src/architecture/Training.ts";
import type { DataRecordInterface } from "../src/architecture/DataSet.ts";
import { makeDataDir } from "../src/architecture/DataSet.ts";
import type { CostInterface } from "../src/costs/CostInterface.ts";
import { Creature } from "../src/Creature.ts";
import type { TrainOptions } from "../src/config/TrainOptions.ts";

class ConstantCost implements CostInterface {
  public calls = 0;

  constructor(private readonly value: number) {}

  getName(): string {
    return "ConstantCost";
  }

  calculate(_target: Float32Array, _output: Float32Array): number {
    this.calls++;
    return this.value;
  }
}

Deno.test("trainDir() uses injected CostInterface when provided", () => {
  const creature = new Creature(2, 1);
  const cost = new ConstantCost(123.456);

  const dataSet: DataRecordInterface[] = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  ];

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const options: TrainOptions = {
      iterations: 1,
      disableRandomSamples: true,
    };

    const result = trainDir(creature, dataSetDir, options, cost);

    assert(cost.calls > 0, "Expected injected cost to be used at least once");
    assertAlmostEquals(result.error, 123.456, 1e-9);
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

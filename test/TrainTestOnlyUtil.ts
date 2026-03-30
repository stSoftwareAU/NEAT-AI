import { assert } from "@std/assert";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";
import { trainDir } from "@architecture/Training.ts";
import { Costs } from "@costs";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import type { Creature } from "@creature";

/**
 * Train the given set to this network
 */
export function train(
  creature: Creature,
  dataSet: DataRecordInterface[],
  options: TrainOptions,
  cost: CostInterface = Costs.find("MSE"),
) {
  assert(dataSet.length > 0, "No data set provided");
  assert(dataSet[0].input.length > 0, "No input data in the data set");
  assert(dataSet[0].output.length > 0, "No output data in the data set");

  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });
  try {
    const result = trainDir(creature, dataSetDir, options, cost);
    return result;
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
}

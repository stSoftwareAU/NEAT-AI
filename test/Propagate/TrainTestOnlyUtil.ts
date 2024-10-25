import { assert } from "@std/assert/assert";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import { trainDir } from "../../src/architecture/Training.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";
import type { Creature } from "../../src/Creature.ts";

/**
 * Train the given set to this network
 */
export function train(
  creature: Creature,
  dataSet: DataRecordInterface[],
  options: TrainOptions,
) {
  assert(dataSet.length > 0, "No data set provided");
  assert(dataSet[0].input.length > 0, "No input data in the data set");
  assert(dataSet[0].output.length > 0, "No output data in the data set");

  const dataSetDir = makeDataDir(dataSet, dataSet.length);
  try {
    const result = trainDir(creature, dataSetDir, options);
    return result;
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
}

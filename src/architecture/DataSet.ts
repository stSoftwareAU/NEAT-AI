/**
 * @module
 *
 * Training-dataset serialisation. {@link makeDataDir} writes an array of
 * input/output {@link DataRecordInterface} records to partitioned binary files
 * in a temporary directory, the on-disk format the trainer streams during
 * evolution so a large dataset need not be held in memory at once.
 */
import { ValidationError } from "@errors/ValidationError.ts";

export interface DataRecordInterface {
  input: Float32Array;
  output: Float32Array;
}

export function makeDataDir(
  dataSet: DataRecordInterface[],
  partitionBreak: number,
  validate?: { input: number; output: number },
) {
  if (partitionBreak < 1) {
    throw new ValidationError(
      `must have a positive partition break was: ${partitionBreak}`,
      "OTHER",
    );
  }

  const dataSetDir = Deno.makeTempDirSync({ prefix: "dataSet-" });

  let completed = false;
  for (let loop = 0; completed === false; loop++) {
    const fn = dataSetDir + "/" + loop + ".bin";
    const file = Deno.openSync(fn, {
      write: true,
      create: true,
    });

    let counter = 0;
    for (; counter < partitionBreak; counter++) {
      const pos = partitionBreak * loop + counter;
      if (pos >= dataSet.length) {
        completed = true;
        break;
      }

      const record = dataSet[pos];
      if (validate) {
        if (record.input.length !== validate.input) {
          throw new ValidationError(
            `input length mismatch: ${record.input.length} !== ${validate.input}`,
            "OTHER",
          );
        }
        if (record.output.length !== validate.output) {
          throw new ValidationError(
            `output length mismatch: ${record.output.length} !== ${validate.output}`,
            "OTHER",
          );
        }
      }
      const array = new Float32Array(
        record.input.length + record.output.length,
      );
      array.set(record.input);
      array.set(record.output, record.input.length);
      file.writeSync(new Uint8Array(array.buffer));
    }
    file.close();

    if (counter === 0) {
      Deno.removeSync(fn);
    }
  }

  return dataSetDir;
}

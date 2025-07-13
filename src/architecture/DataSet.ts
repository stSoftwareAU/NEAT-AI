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
    throw new Error(
      `must have a positive partition break was: ${partitionBreak}`,
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
          throw new Error(
            `input length mismatch: ${record.input.length} !== ${validate.input}`,
          );
        }
        if (record.output.length !== validate.output) {
          throw new Error(
            `output length mismatch: ${record.output.length} !== ${validate.output}`,
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

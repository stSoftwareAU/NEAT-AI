export interface DataRecordInterface {
  input: number[];
  output: number[];
}

export function makeDataDir(
  dataSet: DataRecordInterface[],
  partitionBreak = 2000,
) {
  if (partitionBreak < 1) {
    throw new Error(
      `must have a positive partition break was: ${partitionBreak}`,
    );
  }

  const dataSetDir = Deno.makeTempDirSync({ prefix: "dataSet-" });

  let completed = false;
  for (let loop = 0; completed == false; loop++) {
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
      const array = new Float32Array(
        record.input.length + record.output.length,
      );
      array.set(record.input);
      array.set(record.output, record.input.length);
      file.writeSync(new Uint8Array(array.buffer));
    }
    file.close();

    if (counter == 0) {
      Deno.removeSync(fn);
    }
  }

  return dataSetDir;
}

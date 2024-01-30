export interface DataRecordInterface {
  input: number[];
  output: number[];
}

const encoder = new TextEncoder();

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
    const fn = dataSetDir + "/" + loop + ".json";
    const file = Deno.openSync(fn, {
      write: true,
      create: true,
    });

    file.writeSync(encoder.encode("[\n"));

    let counter = 0;
    for (; counter < partitionBreak; counter++) {
      const pos = partitionBreak * loop + counter;
      if (pos >= dataSet.length) {
        completed = true;
        break;
      }
      if (counter != 0) {
        file.writeSync(encoder.encode(",\n"));
      }

      const record = dataSet[pos];

      file.writeSync(encoder.encode(JSON.stringify(record)));
    }
    file.writeSync(encoder.encode("\n]"));
    file.close();

    if (counter == 0) {
      Deno.removeSync(fn);
    }
  }

  return dataSetDir;
}

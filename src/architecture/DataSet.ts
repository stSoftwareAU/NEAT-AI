export interface DataRecordInterface {
  input: number[];
  output: number[];
}

export function freezeAndValidate(
  dataSet: DataRecordInterface[],
) {
  Object.freeze(dataSet);
  for (let i = dataSet.length; i--;) {
    const tmpIn = dataSet[i].input;
    const tmpOut = dataSet[i].output;
    Object.freeze(tmpIn);
    Object.freeze(tmpOut);
    for (let j = tmpIn.length; j--;) {
      const v = tmpIn[j];
      if (
        isFinite(v) == false
      ) {
        console.trace();
        throw i + ":" + j + ") Input not within range: " + v;
      }
    }
    for (let k = tmpOut.length; k--;) {
      const v = tmpOut[k];
      if (
        isFinite(v) == false ||
        typeof v !== "number"
      ) {
        console.trace();
        throw i + ":" + k + ") Output not within range: " + v;
      }
    }
  }
}

export function makeDataDir(dataSet: DataRecordInterface[]) {
  const dataSetDir = Deno.makeTempDirSync({ prefix: "dataSet-" });
  const partitionBreak = 1000;

  const encoder = new TextEncoder();

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

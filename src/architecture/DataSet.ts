export function freezeAndValidate(
  dataSet: { input: number[]; output: number[] }[],
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
        isFinite(v) == false ||
        typeof v !== "number" ||
        v < -1 ||
        v > 1
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

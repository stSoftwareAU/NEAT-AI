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
        isFinite(v) == false //||
        // typeof v !== "number" //||
        // v < -1 ||
        // v > 1
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

export function shuffle(array: number[]) {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {
    // Pick a remaining element...
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }

  return array;
}

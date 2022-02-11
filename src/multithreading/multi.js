/*******************************************************************************
                                MULTITHREADING
*******************************************************************************/
import { Workers } from "./workers/workers.js";

export const Multi = {
  /** Workers */
  workers: Workers,
  // workers: require('./workers/workers'),

  /** Serializes a dataset
  serializeDataSet: function (dataSet) {
    const serialized = [dataSet[0].input.length, dataSet[0].output.length];

    for (let i = 0; i < dataSet.length; i++) {
      let j;
      for (j = 0; j < serialized[0]; j++) {
        serialized.push(dataSet[i].input[j]);
      }
      for (j = 0; j < serialized[1]; j++) {
        serialized.push(dataSet[i].output[j]);
      }
    }

    return serialized;
  },
  */
  /** Activate a serialized network */
  activateSerializedNetwork: function (input, A, S, data, F) {
    for (let i = 0; i < data[0]; i++) A[i] = input[i];
    for (let i = 2; i < data.length; i++) {
      const index = data[i++];
      const bias = data[i++];
      const squash = data[i++];
      const selfweight = data[i++];
      const selfgater = data[i++];

      S[index] = (selfgater === -1 ? 1 : A[selfgater]) * selfweight * S[index] +
        bias;

      while (data[i] !== -2) {
        S[index] += A[data[i++]] * data[i++] *
          (data[i++] === -1 ? 1 : A[data[i - 1]]);
      }
      A[index] = F[squash](S[index]);
    }

    /* extend */
    const offset = A.length - data[1];
    const len = A.length;
    const output = [len - offset];
    let pos = 0;
    for (let i = offset; i < len; i++) {
      output[pos++] = A[i];
    }
    return output;
  },

  /** Deserializes a dataset to an array of arrays
  deserializeDataSet: function (serializedSet) {
    const set = [];

    const sampleSize = serializedSet[0] + serializedSet[1];
    for (let i = 0; i < (serializedSet.length - 2) / sampleSize; i++) {
      const input = [];
      for (
        let j = 2 + i * sampleSize;
        j < 2 + i * sampleSize + serializedSet[0];
        j++
      ) {
        input.push(serializedSet[j]);
      }
      const output = [];
      for (
        let j = 2 + i * sampleSize + serializedSet[0];
        j < 2 + i * sampleSize + sampleSize;
        j++
      ) {
        output.push(serializedSet[j]);
      }
      set.push(input);
      set.push(output);
    }

    return set;
  },
  */
  /** A list of compiled activation functions in a certain order */
  activations: [
    function (x) {
      return 1 / (1 + Math.exp(-x));
    },
    function (x) {
      return Math.tanh(x);
    },
    function (x) {
      return x;
    },
    function (x) {
      return x > 0 ? 1 : 0;
    },
    function (x) {
      return x > 0 ? x : 0;
    },
    function (x) {
      return x / (1 + Math.abs(x));
    },
    function (x) {
      return Math.sin(x);
    },
    function (x) {
      return Math.exp(-Math.pow(x, 2));
    },
    function (x) {
      return (Math.sqrt(Math.pow(x, 2) + 1) - 1) / 2 + x;
    },
    function (x) {
      return x > 0 ? 1 : -1;
    },
    function (x) {
      return 2 / (1 + Math.exp(-x)) - 1;
    },
    function (x) {
      return Math.max(-1, Math.min(1, x));
    },
    function (x) {
      return Math.abs(x);
    },
    function (x) {
      return 1 - x;
    },
    function (x) {
      const a = 1.6732632423543772848170429916717;
      return (x > 0 ? x : a * Math.exp(x) - a) *
        1.0507009873554804934193349852946;
    },
  ],
};

Multi.testSerializedSet = function (set, cost, A, S, data, F) {
  // Calculate how much samples are in the set
  let error = 0;
  const len = set.length;
  for (let i = 0; i < len; i++) {
    const output = Multi.activateSerializedNetwork(set[i].input, A, S, data, F);
    error += cost(set[i].output, output);
  }

  return error / len;
};

// /* Export */
// for (var i in Multi) {
//   module.exports[i] = multi[i];
// }

/*******************************************************************************
                                MULTITHREADING
*******************************************************************************/
import { Methods } from "../methods/methods.js";

export const Multi = {

  /** Activate a serialized network */
  activateSerializedNetwork: function (input, A, S, data) {
    for (let i = data[0]; i--;) A[i] = input[i];

    for (let i = 2, len = data.length; i < len; i++) {
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

      A[index] = Methods.activation[squash](S[index]);
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

  testSerializedSet: function (set, cost, A, S, data) {
    // Calculate how much samples are in the set
    let error = 0;

    const len = set.length;
    for (let i = len; i--;) {
      const output = this.activateSerializedNetwork(
        set[i].input,
        A,
        S,
        data,
      );
      error += cost(set[i].output, output);
    }

    return error / len;
  },
};

/*******************************************************************************
 **                                  COST FUNCTIONS
 ** https://en.wikipedia.org/wiki/Loss_function
 *******************************************************************************/

export const Cost = {
  /** Cross entropy error */
  CROSS_ENTROPY: function (target: number[], output: number[]) {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      // Avoid negative and zero numbers, use 1e-15 http://bit.ly/2p5W29A
      const t = target[i];
      const o = output[i];
      error -= t * Math.log(Math.max(o, 1e-15)) +
        (1 - t) * Math.log(1 - Math.max(o, 1e-15));
    }

    return error / len;
  },

  /** Mean Squared Error */
  MSE: function (target: number[], output: number[]) {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      error += Math.pow(target[i] - output[i], 2);
    }

    return error / len;
  },

  /** Binary error */
  BINARY: function (target: number[], output: number[]) {
    let misses = 0;
    for (let i = output.length; i--;) {
      misses += Math.round(target[i] * 2) !== Math.round(output[i] * 2) ? 0 : 1;
    }

    return misses;
  },

  /** Mean Absolute Error */
  MAE: function (target: number[], output: number[]) {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      error += Math.abs(target[i] - output[i]);
    }

    return error / len;
  },

  /** Mean Absolute Percentage Error */
  MAPE: function (target: number[], output: number[]) {
    let error = 0;
    const len = output.length;

    for (let i = len; i--;) {
      const t = target[i];
      const o = output[i];
      error += Math.abs((o - t) / Math.max(t, 1e-15));
    }

    return error / len;
  },

  /** Mean Squared Logarithmic Error */
  MSLE: function (target: number[], output: number[]) {
    let error = 0;
    for (let i = output.length; i--;) {
      error += Math.log(Math.max(target[i], 1e-15)) -
        Math.log(Math.max(output[i], 1e-15));
    }

    return error;
  },

  /** Hinge loss, for classifiers */
  HINGE: function (target: number[], output: number[]) {
    let error = 0;
    for (let i = output.length; i--;) {
      error += Math.max(0, 1 - target[i] * output[i]);
    }

    return error;
  },
};

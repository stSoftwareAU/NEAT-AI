/*******************************************************************************
                                  ACTIVATION FUNCTIONS
*******************************************************************************/

// https://en.wikipedia.org/wiki/Activation_function
// https://stats.stackexchange.com/questions/115258/comprehensive-list-of-activation-functions-in-neural-networks-with-pros-cons
export const Activation = {
  // LOGISTIC: function (x, derivate) {
  //   const fx = 1 / (1 + Math.exp(-x));
  //   if (!derivate) return fx;
  //   return fx * (1 - fx);
  // },
  // TANH: function (x, derivate) {
  //   if (derivate) return 1 - Math.pow(Math.tanh(x), 2);
  //   return Math.tanh(x);
  // },
  // IDENTITY: function (x, derivate) {
  //   return derivate ? 1 : x;
  // },
  // STEP: function (x, derivate) {
  //   return derivate ? 0 : x > 0 ? 1 : 0;
  // },
  // RELU: function (x, derivate) {
  //   if (derivate) return x > 0 ? 1 : 0;
  //   return x > 0 ? x : 0;
  // },
  // SOFTSIGN: function (x, derivate) {
  //   const d = 1 + Math.abs(x);
  //   if (derivate) return x / Math.pow(d, 2);
  //   return x / d;
  // },
  // SINUSOID: function (x, derivate) {
  //   if (derivate) return Math.cos(x);
  //   return Math.sin(x);
  // },
  GAUSSIAN: function (x, derivate) {
    const d = Math.exp(-Math.pow(x, 2));
    if (derivate) return -2 * x * d;
    return d;
  },
  BENT_IDENTITY: function (x, derivate) {
    const d = Math.sqrt(Math.pow(x, 2) + 1);
    if (derivate) return x / (2 * d) + 1;
    return (d - 1) / 2 + x;
  },
  BIPOLAR: function (x, derivate) {
    return derivate ? 0 : x > 0 ? 1 : -1;
  },
  BIPOLAR_SIGMOID: function (x, derivate) {
    const d = 2 / (1 + Math.exp(-x)) - 1;
    if (derivate) return 1 / 2 * (1 + d) * (1 - d);
    return d;
  },
  HARD_TANH: function (x, derivate) {
    if (derivate) return x > -1 && x < 1 ? 1 : 0;
    return Math.max(-1, Math.min(1, x));
  },
  ABSOLUTE: function (x, derivate) {
    if (derivate) return x < 0 ? -1 : 1;
    return Math.abs(x);
  },
  INVERSE: function (x, derivate) {
    if (derivate) return -1;
    return 1 - x;
  },
  // https://arxiv.org/pdf/1706.02515.pdf
  SELU: function (x, derivate) {
    const alpha = 1.6732632423543772848170429916717;
    const scale = 1.0507009873554804934193349852946;
    const fx = x > 0 ? x : alpha * Math.exp(x) - alpha;
    if (derivate) return x > 0 ? scale : (fx + alpha) * scale;
    return fx * scale;
  },
};

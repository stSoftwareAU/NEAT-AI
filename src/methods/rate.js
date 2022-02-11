/*******************************************************************************
                                      RATE
*******************************************************************************/

// https://stackoverflow.com/questions/30033096/what-is-lr-policy-in-caffe/30045244
export const Rate = {
  FIXED: function () {
    const func = function (baseRate) {
      return baseRate;
    };
    return func;
  },
  STEP: function (gamma, stepSize) {
    gamma = gamma || 0.9;
    stepSize = stepSize || 100;

    const func = function (baseRate, iteration) {
      return baseRate * Math.pow(gamma, Math.floor(iteration / stepSize));
    };

    return func;
  },
  EXP: function (gamma) {
    gamma = gamma || 0.999;

    const func = function (baseRate, iteration) {
      return baseRate * Math.pow(gamma, iteration);
    };

    return func;
  },
  INV: function (gamma, power) {
    gamma = gamma || 0.001;
    power = power || 2;

    const func = function (baseRate, iteration) {
      return baseRate * Math.pow(1 + gamma * iteration, -power);
    };

    return func;
  },
};

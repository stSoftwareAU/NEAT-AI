/*******************************************************************************
                                      RATE
*******************************************************************************/

const RateConfig = {
  STEP: {
    gamma: 0.9,
    stepSize: 100,
  },
  EXP: {
    gamma: 0.999,
  },
  INV: {
    gamma: 0.001,
    power: 2,
  },
};

// https://stackoverflow.com/questions/30033096/what-is-lr-policy-in-caffe/30045244
export const Rate = {
  FIXED: function (baseRate: number) {
    return baseRate;
  },

  STEP: function (baseRate: number, iteration: number) {
    return baseRate *
      Math.pow(
        RateConfig.STEP.gamma,
        Math.floor(iteration / RateConfig.STEP.stepSize),
      );
  },

  EXP: function (baseRate: number, iteration: number) {
    return baseRate * Math.pow(RateConfig.EXP.gamma, iteration);
  },

  INV: function (baseRate: number, iteration: number) {
    return baseRate *
      Math.pow(1 + RateConfig.INV.gamma * iteration, -RateConfig.INV.power);
  },
};

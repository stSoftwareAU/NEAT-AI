/*******************************************************************************
                                      CROSSOVER
*******************************************************************************/

// https://en.wikipedia.org/wiki/Crossover_(genetic_algorithm)
export const Crossover = {
  SINGLE_POINT: {
    name: "SINGLE_POINT",
    config: [0.4],
  },
  TWO_POINT: {
    name: "TWO_POINT",
    config: [0.4, 0.9],
  },
  UNIFORM: {
    name: "UNIFORM",
  },
  AVERAGE: {
    name: "AVERAGE",
  },
};

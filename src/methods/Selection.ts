/*******************************************************************************
 **                                    SELECTION
 **  https://en.wikipedia.org/wiki/Selection_(genetic_algorithm)
 *******************************************************************************/

export const Selection = {
  FITNESS_PROPORTIONATE: {
    name: "FITNESS_PROPORTIONATE",
  },
  POWER: {
    name: "POWER",
    power: 4,
  },
  TOURNAMENT: {
    name: "TOURNAMENT",
    size: 5,
    probability: 0.5,
  },
};

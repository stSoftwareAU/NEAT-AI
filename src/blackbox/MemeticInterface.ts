export interface MemeticWeightInterface {
  toUUID: string;
  weight: number;
}

export interface MemeticBiasInterface {
  [neuronUUID: string]: number;
}

export interface MemeticWeightsInterface {
  [fromUUID: string]: MemeticWeightInterface[];
}

export interface MemeticInterface {
  generation: number;
  weights: MemeticWeightsInterface;
  biases: MemeticBiasInterface;
  score: number;
}

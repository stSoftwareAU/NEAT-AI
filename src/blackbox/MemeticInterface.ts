export interface MemeticWeightInterface {
  fromUUID: string;
  toUUID: string;
  weight: number;
}

export interface MemeticBiasInterface {
  neuronUUID: string;
  bias: number;
}
export interface MemeticInterface {
  generations: number;
  weights: MemeticWeightInterface[];
  biases: MemeticBiasInterface[];
  score: number;
}

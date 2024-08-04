export interface MemeticInterface {
  generations: number;
  weights: [{ fromUUID: string; toUUID: string; weight: number }];
  biases: [{ neuronUUID: string; bias: number }];
  score: number;
}

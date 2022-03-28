import { NetworkInterface } from "./NetworkInterface.ts";

export interface FitnessInterface extends NetworkInterface {
  calculatedScore: number;
}

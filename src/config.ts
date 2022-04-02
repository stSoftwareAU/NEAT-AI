/*******************************************************************************
                                      CONFIG
*******************************************************************************/
import { NetworkInterface } from "./architecture/NetworkInterface.ts";

interface ScheduleInterface {
  iterations: number;
  // deno-lint-ignore ban-types
  function: Function;
}

export interface NeatConfigInterface {
  warnings?: boolean;
  clear?: boolean;
  error?: number;
  growth?: number;
  elitism?: number;
  costName?: string;
  threads?: number;
  iterations?: number;
  log?: number;
  fitnessPopulation?: boolean; /** No idea what this does */
  schedule?: ScheduleInterface;
  network?: NetworkInterface;
}

// Config
export const Config: NeatConfigInterface = {
  warnings: false,
};

export class SynapseState {
  count = 0;

  totalPositiveActivation = 0;
  totalNegativeActivation = 0;
  countNegativeActivations = 0;
  countPositiveActivations = 0;

  totalPositiveAdjustedValue = 0;
  totalNegativeAdjustedValue = 0;

  batchAverageWeight?: number;
  public used?: boolean;
}

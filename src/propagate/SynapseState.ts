export class SynapseState {
  count = 0;

  averageWeight = 0;
  totalActivation = 0;
  totalValue = 0;

  totalAdjustedValue = 0;
  totalAdjustedActivation = 0;

  absoluteTotalActivation = 0;
  totalPositiveActivation = 0;
  totalNegativeActivation = 0;
  totalPositiveValue = 0;
  totalNegativeValue = 0;
  
  public used?: boolean;
}

export interface AbstractActivationInterface {
  getName(): string;
  range(): { low: number; high: number };
}

export interface ConnectionInterface {
  from: number;
  to: number;
  weight: number;
  gater?: number;
  type?: "positive" | "negative" | "condition";

  /** not persisted */
  gain: number;
}

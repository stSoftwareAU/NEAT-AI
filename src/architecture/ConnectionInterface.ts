interface ConnectionInterface {
  from: number;
  to: number;
  weight: number;
  gater?: number;
  type?: string;

  /** not persisted */
  gain: number;
}

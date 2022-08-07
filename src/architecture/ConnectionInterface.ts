export interface ConnectionInterface {
  from: number;
  to: number;
  weight: number;
  gater?: number;
  type?: "positive" | "negative" | "condition";
}

// export interface TransitantConnectionInterface extends ConnectionInterface {

//   /** not persisted */
//   gain: number;
// }

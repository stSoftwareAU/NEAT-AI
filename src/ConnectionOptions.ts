/**
 * Options for configuring neural network connections.
 * 
 * This interface defines parameters that control how connections
 * are created and modified in neural networks.
 */
export interface ConnectionOptions {
  /** Scaling factor for connection weights during creation or modification */
  weightScale: number;
}

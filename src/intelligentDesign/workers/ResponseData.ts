/**
 * Response data structure for Intelligent Design worker scoring operations.
 *
 * @module
 */

/**
 * Data returned from a scoring worker task.
 */
export interface ResponseData {
  /** Unique identifier for the task */
  taskID: number;
  /** Duration of the operation in milliseconds */
  duration: number;
  /** Scoring result (present when a score request was made) */
  score?: {
    /** UUID of the neuron being tested */
    uuid: string;
    /** The score achieved */
    score: number;
    /** JSON string representation of the scored creature */
    creature: string;
    /** Error value from the evaluation */
    error: number;
  };
}

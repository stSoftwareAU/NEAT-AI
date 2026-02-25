/**
 * Shared worker interface contract.
 *
 * Defines the minimal API that both real Deno Workers and in-process
 * MockWorker implementations must satisfy. Used by WorkerHandlerBase
 * and its domain-specific subclasses.
 *
 * @module
 */

/**
 * Base message shape that all worker request types must satisfy.
 *
 * Domain-specific request types (multithreading, intelligentDesign) extend
 * this with additional operation-specific fields.
 */
export interface BaseRequestData {
  /** Unique identifier for the task */
  taskID: number;
}

/**
 * Base message shape that all worker response types must satisfy.
 *
 * Domain-specific response types extend this with operation-specific fields.
 */
export interface BaseResponseData {
  /** Unique identifier for the task */
  taskID: number;
  /** Duration of the operation in milliseconds */
  duration: number;
}

/**
 * Interface for worker implementations.
 *
 * Defines the contract that worker implementations must follow,
 * whether they are actual Web Workers or mock implementations.
 */
export interface WorkerInterface<TRequest extends BaseRequestData> {
  /**
   * Adds an event listener to the worker.
   *
   * @param type - Type of event to listen for
   * @param listener - Event listener function
   * @param options - Optional event listener options
   */
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;

  /**
   * Sends a message to the worker.
   *
   * @param data - Data to send to the worker
   */
  postMessage(data: TRequest, transfer?: Transferable[]): void;

  /**
   * Terminates the worker.
   */
  terminate(): void;
}
